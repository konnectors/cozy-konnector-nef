'use strict'

// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://d76719f817944d2c922d93a39f72a233:727212fa092f47bc95f8ee7fc3be3b3e@sentry.cozycloud.cc/28'

const {
  BaseKonnector,
  addData,
  log,
  requestFactory,
  signin,
  updateOrCreate,
  cozyClient
} = require('cozy-konnector-libs')
const moment = require('moment-timezone')
moment.locale('fr')
moment.tz.setDefault('Europe/Paris')

const baseUrl = `https://espace-client.lanef.com/templates`
module.export = new BaseKonnector(start)

const rq = requestFactory({
  jar: true,
  json: false,
  cheerio: true
})

function start(fields) {
  return login(fields)
    .then(parseAccounts)
    .then(fetchIBANs)
    .then(saveAccounts)
    .then(accounts =>
      Promise.all([
        ...accounts.map(account =>
          fetchOperations(account).then(saveOperations)
        ),
        fetchBalances(accounts).then(saveBalances)
      ])
    )
}

function login(fields) {
  log('info', 'Logging in')
  const formData = {
    USERID: fields.login,
    STATIC: fields.password
  }
  return signin({
    url: `${baseUrl}/logon/logon.cfm`,
    formSelector: '#formSignon',
    formData,
    parse: 'cheerio',
    validate: (statusCode, $) => $('#welcomebar').length === 1
  })
}

function parseAccounts() {
  log('info', 'Gettings accounts')

  return rq(`${baseUrl}/landingPage/accountListWidget.cfm`).then($ => {
    const accounts = Array.from($('#accountList li')).map(item => {
      // NOTE It is possible that the user has given their account a pseudo
      const label = $(item)
        .children('div')
        .eq(0)
        .text()
        .trim()
      return {
        institutionLabel: 'La Nef',
        label,
        balance: parseAmount(
          $(item)
            .find('.pc-formatted-amount-value')
            .text()
        ),
        type: label.match(/Parts Sociales/) ? 'liability' : 'bank',
        number: $(item).data('value')
      }
    })

    return Promise.resolve(accounts)
  })
}

function fetchIBANs(accounts) {
  log('info', 'Fetching IBANs')

  const params = {
    accType: 'IBAN',
    currencyCode: 'EUR',
    page: '1',
    viewMode: 'GRID'
  }

  return Promise.all(
    accounts.map(account => {
      if (account.type !== 'bank') {
        // Only bank accounts can have an IBAN
        return Promise.resolve(account)
      } else {
        return rq({
          uri: `${baseUrl}/account/IBANDetail.cfm`,
          method: 'POST',
          form: {
            AccNum: account.number,
            ...params
          }
        }).then($ => {
          return Promise.resolve({
            iban: $('.row')
              .eq(12)
              .children('div')
              .eq(1)
              .text()
              .trim(),
            ...account
          })
        })
      }
    })
  )
}

function saveAccounts(accounts) {
  return updateOrCreate(accounts, 'io.cozy.bank.accounts', [
    'institutionLabel',
    'number'
  ])
}

function fetchOperations(account) {
  log('info', `Gettings operations for ${account.label} over the last 10 years`)

  const params = {
    AccNum: account.number,
    uniqueKey: `detailContent_${account.number}`,
    startDate: moment()
      .subtract(10, 'year')
      .format('YYYY-MM-DD'),
    endDate: moment().format('YYYY-MM-DD'),
    orderBy: 'TRANSACTION_DATE_DESCENDING',
    page: '1',
    screenSize: 'LARGE',
    showBalance: true,
    viewMode: 'GRID',
    source: '',
    transactionCode: ''
  }

  return rq({
    uri: `${baseUrl}/account/accountActivityListWidget.cfm`,
    method: 'POST',
    form: params
  }).then($ => {
    const rows = Array.from($('table tbody').children('tr.activity-data-rows'))
    return Promise.resolve(
      rows.map(row => {
        const cells = Array.from($(row).children('td')).map(cell =>
          $(cell)
            .text()
            .trim()
        )
        return {
          label: cells[5],
          type: 'none', // TODO parse the labels for that
          date: parseDate(cells[2]),
          dateOperation: parseDate(cells[1]),
          amount: parseAmount(cells[4]),
          currency: 'EUR',
          account: account._id
        }
      })
    )
  })
}

function saveOperations(operations) {
  return addData(operations, 'io.cozy.bank.operations')
}

function parseAmount(amount) {
  return parseFloat(
    amount
      .trim()
      .replace('\xa0', '')
      .replace(',', '.')
  )
}

function parseDate(date) {
  return moment.tz(date, 'D MMM YYYY', 'Europe/Paris').format()
}

async function getBalanceHistory(year, accountId) {
  const index = await cozyClient.data.defineIndex(
    'io.cozy.bank.balancehistories',
    ['year', 'relationships.account.data._id']
  )
  const options = {
    selector: { year, 'relationships.account.data._id': accountId },
    limit: 1
  }
  const [balance] = await cozyClient.data.query(index, options)

  if (balance) {
    log(
      'info',
      `Found a io.cozy.bank.balancehistories document for year ${year} and account ${accountId}`
    )
    return balance
  }

  log(
    'info',
    `io.cozy.bank.balancehistories document not found for year ${year} and account ${accountId}, creating a new one`
  )
  return getEmptyBalanceHistory(year, accountId)
}

function getEmptyBalanceHistory(year, accountId) {
  return {
    year,
    balances: {},
    metadata: {
      version: 1
    },
    relationships: {
      account: {
        data: {
          _id: accountId,
          _type: 'io.cozy.bank.accounts'
        }
      }
    }
  }
}

function fetchBalances(accounts) {
  const now = moment()
  const todayAsString = now.format('YYYY-MM-DD')
  const currentYear = now.year()

  return Promise.all(
    accounts.map(account => {
      const history = getBalanceHistory(currentYear, account._id)
      history.balances[todayAsString] = account.balance

      return history
    })
  )
}

function saveBalances(balances) {
  return updateOrCreate(balances, 'io.cozy.bank.balancehistories', ['_id'])
}
