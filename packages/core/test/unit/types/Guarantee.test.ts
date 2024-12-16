import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  GuaranteeGlobalTester,
  GuaranteeLocalTester,
  GuaranteeGlobalTester__factory,
  GuaranteeLocalTester__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import { GuaranteeStruct } from '../../../types/generated/contracts/Market'
import { parse6decimal, DEFAULT_ORDER, DEFAULT_GUARANTEE, expectGuaranteeEq } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Guarantee', () => {
  let owner: SignerWithAddress

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()
  })

  describe('global', () => {
    const VALID_STORED_GUARANTEE: GuaranteeStruct = {
      orders: 2,
      longPos: 3,
      longNeg: 4,
      shortPos: 5,
      shortNeg: 6,
      notional: 0,
      takerFee: 7,
      referral: 0,
    }

    let guaranteeGlobal: GuaranteeGlobalTester

    beforeEach(async () => {
      guaranteeGlobal = await new GuaranteeGlobalTester__factory(owner).deploy()
    })

    describe('common behavior', () => {
      shouldBehaveLike(() => ({ guarantee: guaranteeGlobal, validStoredGuarantee: VALID_STORED_GUARANTEE }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await guaranteeGlobal.store(VALID_STORED_GUARANTEE)

        const value = await guaranteeGlobal.read()
        expect(value.orders).to.equal(2)
        expect(value.longPos).to.equal(3)
        expect(value.longNeg).to.equal(4)
        expect(value.shortPos).to.equal(5)
        expect(value.shortNeg).to.equal(6)
        expect(value.notional).to.equal(0)
        expect(value.takerFee).to.equal(7)
        expect(value.referral).to.equal(0)
      })
    })
  })

  describe('local', () => {
    const VALID_STORED_GUARANTEE: GuaranteeStruct = {
      orders: 2,
      longPos: 3,
      longNeg: 4,
      shortPos: 5,
      shortNeg: 6,
      notional: 14,
      takerFee: 7,
      referral: 15,
    }

    let guaranteeLocal: GuaranteeLocalTester

    beforeEach(async () => {
      guaranteeLocal = await new GuaranteeLocalTester__factory(owner).deploy()
    })

    describe('common behavior', () => {
      shouldBehaveLike(() => ({ guarantee: guaranteeLocal, validStoredGuarantee: VALID_STORED_GUARANTEE }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await guaranteeLocal.store(VALID_STORED_GUARANTEE)

        const value = await guaranteeLocal.read()
        expect(value.orders).to.equal(2)
        expect(value.longPos).to.equal(3)
        expect(value.longNeg).to.equal(4)
        expect(value.shortPos).to.equal(5)
        expect(value.shortNeg).to.equal(6)
        expect(value.notional).to.equal(14)
        expect(value.takerFee).to.equal(7)
        expect(value.referral).to.equal(15)
      })

      context('.notional', async () => {
        const STORAGE_SIZE = 63
        it('saves if in range (above)', async () => {
          await guaranteeLocal.store({
            ...DEFAULT_GUARANTEE,
            notional: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guaranteeLocal.read()
          expect(value.notional).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('saves if in range (below)', async () => {
          await guaranteeLocal.store({
            ...DEFAULT_GUARANTEE,
            notional: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          })
          const value = await guaranteeLocal.read()
          expect(value.notional).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
        })

        it('reverts if notional out of range (above)', async () => {
          await expect(
            guaranteeLocal.store({
              ...DEFAULT_GUARANTEE,
              notional: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guaranteeLocal, 'GuaranteeStorageInvalidError')
        })

        it('reverts if notional out of range (below)', async () => {
          await expect(
            guaranteeLocal.store({
              ...DEFAULT_GUARANTEE,
              notional: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            }),
          ).to.be.revertedWithCustomError(guaranteeLocal, 'GuaranteeStorageInvalidError')
        })
      })

      context('.referral', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guaranteeLocal.store({
            ...DEFAULT_GUARANTEE,
            referral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guaranteeLocal.read()
          expect(value.referral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if referral out of range', async () => {
          await expect(
            guaranteeLocal.store({
              ...DEFAULT_GUARANTEE,
              referral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guaranteeLocal, 'GuaranteeStorageInvalidError')
        })
      })
    })

    describe('#from', () => {
      it('generates correct guarantee (long open)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longNeg: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long w/ settlement fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long w/ trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
        })
      })

      it('generates correct guarantee (long w/ both fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
        })
      })

      it('generates correct guarantee (long w/ referral + settlement fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          referral: parse6decimal('1'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (long w/ referral + trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (long w/ referral + both fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (long w/ referral)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, longPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          longPos: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (short open)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortNeg: parse6decimal('10'),
          notional: parse6decimal('1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short w/ settlement fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short w/ tarde fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
        })
      })

      it('generates correct guarantee (short w/ both fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          true,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
        })
      })

      it('generates correct guarantee (short w/ referral + settlement fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: parse6decimal('1'),
          takerFee: parse6decimal('10'),
        })
      })

      it('generates correct guarantee (short w/ referral + trade fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (short w/ referral + both fee)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          true,
          true,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (short w/ referral)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, shortPos: parse6decimal('10'), takerReferral: parse6decimal('2') },
          parse6decimal('123'),
          parse6decimal('0.5'),
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
          orders: 1,
          shortPos: parse6decimal('10'),
          notional: parse6decimal('-1230'),
          takerFee: parse6decimal('10'),
          referral: parse6decimal('1'),
        })
      })

      it('generates correct guarantee (maker open)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, makerPos: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
        })
      })

      it('generates correct guarantee (maker close)', async () => {
        await guaranteeLocal.from(
          { ...DEFAULT_ORDER, orders: 1, makerNeg: parse6decimal('10') },
          parse6decimal('123'),
          0,
          false,
          false,
        )
        const newGuarantee = await guaranteeLocal.read()

        expectGuaranteeEq(newGuarantee, {
          ...DEFAULT_GUARANTEE,
        })
      })
    })

    describe('#takerTotal', () => {
      it('calculate taker total', async () => {
        await expect(
          await guaranteeLocal.takerTotal({
            ...DEFAULT_GUARANTEE,
            longPos: 2,
            longNeg: 3,
            shortPos: 4,
            shortNeg: 5,
          }),
        ).to.equal(14)
      })
    })

    describe('#priceAdjustment', () => {
      it('long open / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('short close / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              shortNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('short open / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('long close / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('20'))
      })

      it('long open/ lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('short close / lower price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              shortNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('short open / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('long close / higher price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('-20'))
      })

      it('zero price', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('0'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('-1210'))
      })

      it('zero size', async () => {
        await expect(
          await guaranteeLocal.priceAdjustment(
            {
              ...DEFAULT_GUARANTEE,
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0'))
      })
    })

    describe('#priceDeviation', () => {
      it('long pos / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('short close / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              shortNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('short open / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('long close / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('long open / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('short close / lower price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              shortNeg: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0.016528'))
      })

      it('short open / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('long close / higher price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longNeg: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('0.016260'))
      })

      it('zero price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('0'),
              shortPos: parse6decimal('10'),
            },
            parse6decimal('121'),
          ),
        ).to.equal(ethers.constants.MaxUint256)
      })

      it('negative oracle price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('-125'),
          ),
        ).to.equal(parse6decimal('2.016260'))
      })

      it('negative guarantee price', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
              notional: parse6decimal('-1230'),
              longPos: parse6decimal('10'),
            },
            parse6decimal('125'),
          ),
        ).to.equal(parse6decimal('2.016260'))
      })

      it('zero size', async () => {
        await expect(
          await guaranteeLocal.priceDeviation(
            {
              ...DEFAULT_GUARANTEE,
            },
            parse6decimal('121'),
          ),
        ).to.equal(parse6decimal('0'))
      })
    })
  })

  function shouldBehaveLike(
    getter: () => {
      guarantee: GuaranteeLocalTester | GuaranteeGlobalTester
      validStoredGuarantee: GuaranteeStruct
    },
  ) {
    let guarantee: GuaranteeLocalTester | GuaranteeGlobalTester
    let validStoredGuarantee: GuaranteeStruct

    beforeEach(async () => {
      ;({ guarantee, validStoredGuarantee } = getter())
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await guarantee.store(validStoredGuarantee)

        const value = await guarantee.read()
        expect(value.orders).to.equal(2)
      })

      context('.orders', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await guarantee.store({
            ...validStoredGuarantee,
            orders: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.orders).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            guarantee.store({
              ...validStoredGuarantee,
              orders: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })

      context('.longPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            longPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.longPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if longPos out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              longPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })

      context('.longNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            longNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.longNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if longNeg out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              longNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })

      context('.shortPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            shortPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.shortPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if shortPos out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              shortPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })

      context('.shortNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            shortNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.shortNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if shortNeg out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              shortNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })

      context('.takerFee', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await guarantee.store({
            ...DEFAULT_GUARANTEE,
            takerFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await guarantee.read()
          expect(value.takerFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if takerFee out of range', async () => {
          await expect(
            guarantee.store({
              ...DEFAULT_GUARANTEE,
              takerFee: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(guarantee, 'GuaranteeStorageInvalidError')
        })
      })
    })
  }
})