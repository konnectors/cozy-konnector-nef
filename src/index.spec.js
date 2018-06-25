const lib = require('./lib')
const { BankAccount, BankTransaction, Document } = require('cozy-doctypes')
const asyncResolve = result =>
  new Promise(resolve => {
    setTimeout(() => resolve(result), 1)
  })

describe('nef connector', () => {
  beforeEach(() => {
    Document.createOrUpdate = jest
      .fn()
      .mockImplementation(attrs => Promise.resolve(attrs))
    BankAccount.fetchAll = jest
      .fn()
      .mockReturnValue([
        { number: 'nef1', label: 'Account 1', balance: 60, vendorId: 'nef01' },
        { number: 'nef2', label: 'Account 1', balance: 70, vendorId: 'nef02' }
      ])
    BankTransaction.getMostRecentForAccounts = jest.fn().mockReturnValue([
      {
        label: 'Operation 1',
        amount: 10,
        date: '2018-06-08T00:00Z',
        vendorId: 1
      },
      {
        label: 'Operation 2',
        amount: 8,
        date: '2018-06-09T00:00Z',
        vendorId: 2
      }
    ])
    lib.login = jest.fn().mockReturnValue(Promise.resolve())
    lib.fetchAccounts = jest.fn().mockReturnValue(
      asyncResolve([
        {
          number: 'nef1',
          institutionLabel: 'La Nef',
          balance: 50,
          label: 'Account 1',
          vendorId: 'nef1'
        },
        {
          number: 'nef2',
          institutionLabel: 'La Nef',
          balance: 50,
          label: 'Account 2',
          vendorId: 'nef1'
        }
      ])
    )
    lib.fetchOperations = jest.fn().mockReturnValue(
      asyncResolve([
        {
          amount: 10,
          label: 'Operation 1',
          vendorAccountId: 'nef1',
          date: '2018-06-08T00:00Z'
        },
        {
          amount: 8,
          label: 'Operation 2',
          vendorAccountId: 'nef2',
          date: '2018-06-09T00:00Z'
        },
        {
          amount: 5,
          label: 'Operation 3',
          vendorAccountId: 'nef1',
          date: '2018-06-10T00:00Z'
        },
        {
          amount: 4,
          label: 'Operation 4',
          vendorAccountId: 'nef1',
          date: '2018-06-11T00:00Z'
        }
      ])
    )
  })

  it('should deduplicate account and operations', async () => {
    await lib.start()
    expect(lib.fetchAccounts).toHaveBeenCalled()
    expect(lib.fetchOperations).toHaveBeenCalled()
    expect(Document.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5 })
    )
    expect(Document.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4 })
    )
  })
})
