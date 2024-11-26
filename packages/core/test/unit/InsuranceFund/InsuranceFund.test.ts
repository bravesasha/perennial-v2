import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants, BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  InsuranceFund,
  InsuranceFund__factory,
  IMarketFactory,
  IMarket,
  IERC20Metadata,
} from '../../../types/generated'
import { IOracleProvider } from '@perennial/v2-oracle/types/generated'

const { ethers } = HRE
use(smock.matchers)

describe.only('InsuranceFund', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let factory: FakeContract<IMarketFactory>
  let factoryOwner: SignerWithAddress
  let market1: FakeContract<IMarket>
  let market2: FakeContract<IMarket>
  let oracle1: FakeContract<IOracleProvider>
  let oracle2: FakeContract<IOracleProvider>
  let insuranceFund: InsuranceFund
  let dsu: FakeContract<IERC20Metadata>

  beforeEach(async () => {
    ;[owner, factoryOwner, user] = await ethers.getSigners()

    market1 = await smock.fake<IMarket>('IMarket')
    market2 = await smock.fake<IMarket>('IMarket')
    oracle1 = await smock.fake<IOracleProvider>('IOracleProvider')
    oracle2 = await smock.fake<IOracleProvider>('IOracleProvider')
    factory = await smock.fake<IMarketFactory>('IMarketFactory')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    insuranceFund = await new InsuranceFund__factory(owner).deploy(factory.address, dsu.address)
    factory.owner.whenCalledWith().returns(factoryOwner.address)
  })

  it('initialize with the correct variables set', async () => {
    await insuranceFund.initialize()

    expect(await insuranceFund.marketFactory()).to.be.equals(factory.address)
  })

  it('reverts if already initialized', async () => {
    await insuranceFund.initialize()
    await expect(insuranceFund.initialize())
      .to.be.revertedWithCustomError(insuranceFund, 'InitializableAlreadyInitializedError')
      .withArgs(1)
  })

  describe('#initialized', async () => {
    beforeEach(async () => {
      await insuranceFund.connect(owner).initialize()
      market1.claimFee.whenCalledWith(factoryOwner.address).returns()
      market2.claimFee.whenCalledWith(factoryOwner.address).returns()
      factory.instances.whenCalledWith(market1.address).returns(true)
      factory.instances.whenCalledWith(market2.address).returns(true)
    })

    context('#claim', async () => {
      it('claims protocol fee from market', async () => {
        await insuranceFund.connect(user).claim(market1.address)
        expect(market1.claimFee).to.have.been.calledWith(factoryOwner.address)

        await insuranceFund.connect(user).claim(market2.address)
        expect(market2.claimFee).to.have.been.calledWith(factoryOwner.address)
      })

      it('reverts with invalid market instance', async () => {
        factory.instances.whenCalledWith(market1.address).returns(false)

        await expect(insuranceFund.connect(user).claim(market1.address)).to.be.revertedWithCustomError(
          insuranceFund,
          'InsuranceFundInvalidInstanceError',
        )
      })
    })

    context('#resolve', async () => {
      it('resolves shortfall for a market', async () => {
        dsu.approve.whenCalledWith(market1.address).returns(true)
        market1.claimExposure.whenCalledWith().returns()

        await insuranceFund.connect(owner).resolve(market1.address)
        expect(dsu.approve).to.have.been.calledWith(market1.address, constants.MaxUint256)
        expect(market1.claimExposure).to.have.been.called
      })

      it('reverts if not owner', async () => {
        await expect(insuranceFund.connect(user).resolve(market1.address)).to.be.revertedWithCustomError(
          insuranceFund,
          'OwnableNotOwnerError',
        )
      })

      it('reverts with invalid market instance', async () => {
        factory.instances.whenCalledWith(market1.address).returns(false)

        await expect(insuranceFund.connect(owner).resolve(market1.address)).to.be.revertedWithCustomError(
          insuranceFund,
          'InsuranceFundInvalidInstanceError',
        )
      })
    })
  })
})
