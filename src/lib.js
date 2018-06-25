const baseUrl = `https://espace-client.lanef.com/templates`
const { signin, log, requestFactory } = require('cozy-konnector-libs')
const moment = require('moment-timezone')
const flatten = require('lodash/flatten')

const {
  BankAccount,
  BankTransaction,
  BankingReconciliator
} = require('cozy-doctypes')

const rq = requestFactory({
  jar: true,
  json: false,
  cheerio: true
})

let lib = {}

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

function fetchAccounts() {
  log('info', 'Gettings accounts')
  return rq(`${baseUrl}/landingPage/accountListWidget.cfm`)
    .then(parseAccounts)
    .then(addIBANs)
}

function parseAccounts($) {
  return Array.from($('#accountList li')).map(item => {
    // NOTE It is possible that the user has given their account a pseudo
    const label = $(item)
      .children('div')
      .eq(0)
      .text()
      .trim()
    const accountNumber = $(item).data('value')
    return {
      institutionLabel: 'La Nef',
      label,
      balance: parseAmount(
        $(item)
          .find('.pc-formatted-amount-value')
          .text()
      ),
      type: label.match(/Parts Sociales/) ? 'liability' : 'bank',
      number: accountNumber,
      vendorId: accountNumber
    }
  })
}

function parseIBAN($) {
  return $('.row')
    .eq(12)
    .children('div')
    .eq(1)
    .text()
    .trim()
}

function addIBANs(accounts) {
  log('info', 'Fetching IBANs')

  const params = {
    accType: 'IBAN',
    currencyCode: 'EUR',
    page: '1',
    viewMode: 'GRID'
  }

  return Promise.all(
    accounts.map(async account => {
      if (account.type !== 'bank') {
        // Only bank accounts can have an IBAN
        return account
      } else {
        const iban = await rq({
          uri: `${baseUrl}/account/IBANDetail.cfm`,
          method: 'POST',
          form: {
            AccNum: account.number,
            ...params
          }
        }).then(parseIBAN)
        return {
          iban: iban,
          ...account
        }
      }
    })
  )
}

async function fetchOperations(account) {
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
  }).then(lib.parseOperations)
}

function parseOperations($) {
  const rows = Array.from($('table tbody').children('tr.activity-data-rows'))
  return rows.map(row => {
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
      currency: 'EUR'
    }
  })
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

const reconciliator = new BankingReconciliator({
  BankAccount,
  BankTransaction
})

async function start(fields) {
  await lib.login(fields)
  const fetchedAccounts = await lib.fetchAccounts()
  const fetchedTransactions = flatten(
    await Promise.all(
      fetchedAccounts.map(async account => {
        const operations = await lib.fetchOperations(account)
        operations.forEach(operation => {
          operation.vendorAccountId = account.number
        })
        return operations
      })
    )
  )
  await reconciliator.save(fetchedAccounts, fetchedTransactions, {})
}

module.exports = lib = {
  parseOperations,
  fetchAccounts,
  parseAccounts,
  login,
  fetchOperations,
  start
}
