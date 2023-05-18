import HRE from 'hardhat'
import { time, impersonate } from '../../../../common/testutil'
import { deployProductOnMainnetFork } from '../helpers/setupHelpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IFactory,
  IFactory__factory,
  IMarket,
  IMarket__factory,
  Vault,
  Vault__factory,
  IOracleProvider__factory,
  IOracleProvider,
  ChainlinkOracle__factory,
} from '../../../types/generated'
import { BigNumber, constants, utils } from 'ethers'
import { deployProtocol, InstanceVars } from '@equilibria/perennial-v2/test/integration/helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'

const { config, ethers } = HRE
use(smock.matchers)

const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

describe('Vault (Multi-Payoff)', () => {
  let vault: Vault
  let asset: IERC20Metadata
  let oracle: FakeContract<IOracleProvider>
  let factory: IFactory
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let perennialUser: SignerWithAddress
  let liquidator: SignerWithAddress
  let market: IMarket
  let leverage: BigNumber
  let maxCollateral: BigNumber
  let originalOraclePrice: BigNumber
  let btcOriginalOraclePrice: BigNumber
  let btcOracle: FakeContract<IOracleProvider>
  let btcMarket: IMarket

  async function updateOracle(newPrice?: BigNumber, newPriceBtc?: BigNumber) {
    await updateOracleEth(newPrice)
    await updateOracleBtc(newPriceBtc)
  }

  async function updateOracleEth(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await oracle.latest()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp.add(13),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    oracle.sync.returns([newVersion, newVersion.version.add(1)])
    oracle.latest.returns(newVersion)
    oracle.at.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function updateOracleBtc(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await btcOracle.latest()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp.add(13),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    btcOracle.sync.returns([newVersion, newVersion.version.add(1)])
    btcOracle.latest.returns(newVersion)
    btcOracle.at.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function updateOracleAndSync(newPrice?: BigNumber) {
    await updateOracle(newPrice)
    await vault.sync()
  }

  async function position() {
    return (await market.positions(vault.address)).maker
  }

  async function btcPosition() {
    return (await btcMarket.positions(vault.address)).maker
  }

  async function collateralInVault() {
    return (await market.locals(vault.address)).collateral
  }

  async function btcCollateralInVault() {
    return (await btcMarket.locals(vault.address)).collateral
  }

  async function totalCollateralInVault() {
    return (await collateralInVault())
      .add(await btcCollateralInVault())
      .mul(1e12)
      .add(await asset.balanceOf(vault.address))
  }

  beforeEach(async () => {
    await time.reset(config)

    const instanceVars = await deployProtocol()

    let btcUser1, btcUser2
    ;[owner, user, user2, liquidator, perennialUser, btcUser1, btcUser2] = await ethers.getSigners()

    const dsu = IERC20Metadata__factory.connect('0x605D26FBd5be761089281d5cec2Ce86eeA667109', owner)
    factory = instanceVars.factory
    const oracleToMock = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      '0x0000000000000000000000000000000000000348',
      1,
    )
    const btcOracleToMock = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      '0x0000000000000000000000000000000000000348',
      1,
    )

    market = await deployProductOnMainnetFork({
      factory: instanceVars.factory,
      token: instanceVars.dsu,
      owner: owner,
      name: 'Ethereum',
      symbol: 'ETH',
      oracle: oracleToMock.address,
      makerLimit: parse6decimal('1000'),
    })
    btcMarket = await deployProductOnMainnetFork({
      factory: instanceVars.factory,
      token: instanceVars.dsu,
      owner: owner,
      name: 'Bitcoin',
      symbol: 'BTC',
      oracle: btcOracleToMock.address,
    })
    leverage = utils.parseEther('4.0')
    maxCollateral = utils.parseEther('500000')

    vault = await new Vault__factory(owner).deploy(factory.address, leverage, maxCollateral, [
      {
        market: market.address,
        weight: 4,
      },
      {
        market: btcMarket.address,
        weight: 1,
      },
    ])
    await vault.initialize('Perennial Vault Alpha')
    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

    const dsuMinter = await impersonate.impersonateWithBalance(DSU_MINTER, utils.parseEther('10'))
    const setUpWalletWithDSU = async (wallet: SignerWithAddress) => {
      const dsuIface = new utils.Interface(['function mint(uint256)'])
      await dsuMinter.sendTransaction({
        to: dsu.address,
        value: 0,
        data: dsuIface.encodeFunctionData('mint', [utils.parseEther('200000')]),
      })
      await dsu.connect(dsuMinter).transfer(wallet.address, utils.parseEther('200000'))
      await dsu.connect(wallet).approve(vault.address, ethers.constants.MaxUint256)
    }
    await setUpWalletWithDSU(user)
    await setUpWalletWithDSU(user2)
    await setUpWalletWithDSU(liquidator)
    await setUpWalletWithDSU(perennialUser)
    await setUpWalletWithDSU(perennialUser)
    await setUpWalletWithDSU(perennialUser)
    await setUpWalletWithDSU(perennialUser)
    await setUpWalletWithDSU(perennialUser)
    await setUpWalletWithDSU(btcUser1)
    await setUpWalletWithDSU(btcUser2)

    // Seed markets with some activity
    await dsu.connect(user).approve(market.address, ethers.constants.MaxUint256)
    await dsu.connect(user2).approve(market.address, ethers.constants.MaxUint256)
    await dsu.connect(btcUser1).approve(btcMarket.address, ethers.constants.MaxUint256)
    await dsu.connect(btcUser2).approve(btcMarket.address, ethers.constants.MaxUint256)
    await market.connect(user).update(user.address, parse6decimal('200'), 0, 0, parse6decimal('100000'))
    await market.connect(user2).update(user2.address, 0, parse6decimal('100'), 0, parse6decimal('100000'))
    await btcMarket.connect(btcUser1).update(btcUser1.address, parse6decimal('20'), 0, 0, parse6decimal('100000'))
    await btcMarket.connect(btcUser2).update(btcUser2.address, 0, parse6decimal('10'), 0, parse6decimal('100000'))

    // Unfortunately, we can't make mocks of existing contracts.
    // So, we make a fake and initialize it with the values that the real contract had at this block.
    const realOracle = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      '0x0000000000000000000000000000000000000348',
      1,
    )
    const currentVersion = await realOracle.latest()
    originalOraclePrice = currentVersion[2]

    oracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: oracleToMock.address,
    })
    oracle.sync.returns([currentVersion, currentVersion.version.add(1)]) // TODO: hardcoded delay
    oracle.latest.returns(currentVersion)
    oracle.at.whenCalledWith(currentVersion[0]).returns(currentVersion)

    const realBtcOracle = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      '0x0000000000000000000000000000000000000348',
      1,
    )
    const btcCurrentVersion = await realBtcOracle.latest()
    btcOriginalOraclePrice = btcCurrentVersion[2]

    btcOracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: btcOracleToMock.address,
    })
    btcOracle.sync.returns([btcCurrentVersion, btcCurrentVersion.version.add(1)]) // TODO: hardcoded delay
    btcOracle.latest.returns(btcCurrentVersion)
    btcOracle.at.whenCalledWith(btcCurrentVersion[0]).returns(btcCurrentVersion)
  })

  describe('#constructor', () => {
    it('checks that there is at least one market', async () => {
      await expect(new Vault__factory(owner).deploy(factory.address, leverage, maxCollateral, [])).to.revertedWith(
        'VaultDefinitionNoMarketsError',
      )
    })

    it('checks that at least one weight is greater than zero', async () => {
      await expect(
        new Vault__factory(owner).deploy(factory.address, leverage, maxCollateral, [
          {
            market: market.address,
            weight: 0,
          },
        ]),
      ).to.revertedWith('VaultDefinitionAllZeroWeightError')

      // At least one of the weights can be zero as long as not all of them are.
      await expect(
        new Vault__factory(owner).deploy(factory.address, leverage, maxCollateral, [
          {
            market: market.address,
            weight: 0,
          },
          {
            market: market.address,
            weight: 1,
          },
        ]),
      ).to.not.be.reverted
    })

    it('checks that all products are valid', async () => {
      await expect(
        new Vault__factory(owner).deploy(factory.address, leverage, maxCollateral, [
          {
            market: '0x0000000000000000000000000000000000000000',
            weight: 1,
          },
        ]),
      ).to.revertedWith('VaultInvalidProductError')
    })

    it('checks that target leverage is positive', async () => {
      await expect(
        new Vault__factory(owner).deploy(factory.address, 0, maxCollateral, [
          {
            market: market.address,
            weight: 1,
          },
        ]),
      ).to.revertedWith('VaultDefinitionZeroTargetLeverageError')
    })
  })

  describe('#initialize', () => {
    it('cant re-initialize', async () => {
      await expect(vault.initialize('Perennial Vault Alpha')).to.revertedWith('UInitializableAlreadyInitializedError')
    })
  })

  describe('#name', () => {
    it('is correct', async () => {
      expect(await vault.name()).to.equal('Perennial Vault Alpha')
    })
  })

  describe('#approve', () => {
    it('approves correctly', async () => {
      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)

      await expect(vault.connect(user).approve(liquidator.address, utils.parseEther('10')))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, utils.parseEther('10'))

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(utils.parseEther('10'))

      await expect(vault.connect(user).approve(liquidator.address, 0))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, 0)

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)
    })
  })

  describe('#deposit/#redeem/#claim/#sync', () => {
    it.only('simple deposits and withdraws', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('10')
      await vault.connect(user).deposit(smallDeposit, user.address)
      expect(await collateralInVault()).to.equal(0)
      expect(await btcCollateralInVault()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault.sync()

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      expect(await collateralInVault()).to.equal(parse6decimal('8008'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2002'))
      expect(await vault.balanceOf(user.address)).to.equal(smallDeposit)
      expect(await vault.totalSupply()).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(utils.parseEther('10'))).to.equal(utils.parseEther('10'))
      expect(await vault.convertToShares(utils.parseEther('10'))).to.equal(utils.parseEther('10'))
      await updateOracle()
      await vault.sync()

      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10010'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10010'))
      expect(await vault.totalAssets()).to.equal(utils.parseEther('10010'))
      expect(await vault.convertToAssets(utils.parseEther('10010'))).to.equal(utils.parseEther('10010'))
      expect(await vault.convertToShares(utils.parseEther('10010'))).to.equal(utils.parseEther('10010'))

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage originalOraclePrice.
      expect(await position()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice).div(1e12).div(1e12),
      )
      expect(await btcPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice).div(1e12).div(1e12),
      )

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await expect(vault.connect(user2).redeem(1, user2.address)).to.be.revertedWith('VaultRedemptionLimitExceeded')

      expect(await vault.maxRedeem(user.address)).to.equal(utils.parseEther('10010'))
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('3415000000000000')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('10010').add(fundingAmount))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('10010').add(fundingAmount))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('10010').add(fundingAmount))

      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('100000').add(fundingAmount))
      expect(await vault.unclaimed(user.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('multiple users', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice).div(1e12).div(1e12),
      )
      expect(await btcPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice).div(1e12).div(1e12),
      )
      const fundingAmount0 = BigNumber.from(83666424963960)
      const balanceOf2 = BigNumber.from('9999999163335820361100')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2))).to.equal(
        utils.parseEther('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('11000').add(fundingAmount0))).to.equal(
        utils.parseEther('1000').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.sync()

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('165941798239422')
      const fundingAmount2 = BigNumber.from('1646882507931229')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('10000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('deposit during withdraw', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const largeDeposit = utils.parseEther('2000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await vault.connect(user).redeem(utils.parseEther('400'), user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        smallDeposit
          .add(largeDeposit)
          .sub(utils.parseEther('400'))
          .mul(4)
          .div(5)
          .mul(leverage)
          .div(2)
          .div(originalOraclePrice),
      )
      expect(await btcPosition()).to.be.equal(
        smallDeposit
          .add(largeDeposit)
          .sub(utils.parseEther('400'))
          .div(5)
          .mul(leverage)
          .div(2)
          .div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from('50199854978376')
      const balanceOf2 = BigNumber.from('1999999832667164072220')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('600'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('2600').add(fundingAmount0))
      expect(await totalCollateralInVault()).to.equal(
        utils
          .parseEther('2600')
          .add(fundingAmount0)
          .add(await vault.totalUnclaimed()),
      )
      expect(await vault.totalSupply()).to.equal(utils.parseEther('600').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('600').add(balanceOf2))).to.equal(
        utils.parseEther('2600').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('2600').add(fundingAmount0))).to.equal(
        utils.parseEther('600').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.sync()

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('133731306363245')
      const fundingAmount2 = BigNumber.from('333934356519138')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('3000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('2000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('3000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('oracles offset', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      const largeDeposit = utils.parseEther('10000')
      const assetsForPosition = (await vault.totalAssets()).add(largeDeposit)
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(originalOraclePrice).div(1e12).div(1e12),
      )
      expect(await btcPosition()).to.be.equal(
        assetsForPosition.mul(leverage).div(5).div(btcOriginalOraclePrice).div(1e12).div(1e12),
      )
      const fundingAmount0 = BigNumber.from(88080044500152)
      const balanceOf2 = BigNumber.from('9999999159583484821247')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2))).to.equal(
        utils.parseEther('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('11000').add(fundingAmount0))).to.equal(
        utils.parseEther('1000').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('166684157907894')
      const fundingAmount2 = BigNumber.from('1654233009885413')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('10000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('oracles offset during pending', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracleEth()
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      let assetsForPosition = (await vault.totalAssets()).add(largeDeposit)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(originalOraclePrice).div(1e12).div(1e12),
      )
      expect(await btcPosition()).to.be.equal(
        assetsForPosition.mul(leverage).div(5).div(btcOriginalOraclePrice).div(1e12).div(1e12),
      )
      const fundingAmount0 = BigNumber.from(88080044500182)
      const balanceOf2 = BigNumber.from('9999999159583484821247')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2))).to.equal(
        utils.parseEther('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('11000').add(fundingAmount0))).to.equal(
        utils.parseEther('1000').add(balanceOf2),
      )

      // Do another epoch update to get pending deposits in
      assetsForPosition = (await vault.totalAssets()).add(largeDeposit)
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()
      await vault.syncAccount(user.address)
      await vault.syncAccount(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(originalOraclePrice).div(1e12).div(1e12),
      )
      expect(await btcPosition()).to.be.equal(
        assetsForPosition.mul(leverage).div(5).div(btcOriginalOraclePrice).div(1e12).div(1e12),
      )
      const fundingAmount1 = BigNumber.from(993109081734194)
      const balanceOf2_1 = BigNumber.from('19999997492742183569043')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2_1)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('21000').add(fundingAmount1))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2_1))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2_1))).to.equal(
        utils.parseEther('21000').add(fundingAmount1),
      )
      expect(await vault.convertToShares(utils.parseEther('21000').add(fundingAmount1))).to.equal(
        utils.parseEther('1000').add(balanceOf2_1),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      await vault.connect(user2).redeem(utils.parseEther('10000'), user2.address)
      await updateOracleEth()
      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()
      await vault.syncAccount(user.address)
      await vault.syncAccount(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('247603340304160')
      const fundingAmount2 = BigNumber.from('4900882935203790')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('21000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('20000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('21000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('maxWithdraw', async () => {
      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const shareAmount = BigNumber.from(utils.parseEther('1000'))
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount)

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const shareAmount2 = BigNumber.from('9999999163335820361100')
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount.add(shareAmount2))

      // We shouldn't be able to withdraw more than maxWithdraw.
      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWith('VaultRedemptionLimitExceeded')

      // But we should be able to withdraw exactly maxWithdraw.
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)

      // The oracle price hasn't changed yet, so we shouldn't be able to withdraw any more.
      expect(await vault.maxRedeem(user.address)).to.equal(0)

      // But if we update the oracle price, we should be able to withdraw the rest of our collateral.
      await updateOracle()
      await vault.sync()

      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // Our collateral should be less than the fixedFloat and greater than 0.
      await vault.claim(user.address)
      expect(await totalCollateralInVault()).to.eq(0)
      expect(await vault.totalAssets()).to.equal(0)
    })

    it('maxDeposit', async () => {
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral)
      const depositSize = utils.parseEther('200000')

      await vault.connect(user).deposit(depositSize, user.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(depositSize))

      await vault.connect(user2).deposit(utils.parseEther('200000'), user2.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(depositSize).sub(depositSize))

      await vault.connect(liquidator).deposit(utils.parseEther('100000'), liquidator.address)
      expect(await vault.maxDeposit(user.address)).to.equal(0)

      await expect(vault.connect(liquidator).deposit(1, liquidator.address)).to.revertedWith(
        'VaultDepositLimitExceeded',
      )
    })

    it('rebalances collateral', async () => {
      await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
      await updateOracle()
      await vault.sync()

      const originalTotalCollateral = await totalCollateralInVault()

      await updateOracle(utils.parseEther('1300'))
      await market.connect(user).settle(vault.address)

      await vault.sync()

      await updateOracle(originalOraclePrice)
      await vault.sync()

      // Since the price changed then went back to the original, the total collateral should have increased.
      const fundingAmount = BigNumber.from('14258756963781699')
      expect(await totalCollateralInVault()).to.eq(originalTotalCollateral.add(fundingAmount))
      expect(await vault.totalAssets()).to.eq(originalTotalCollateral.add(fundingAmount))
    })

    it('rounds deposits correctly', async () => {
      const oddDepositAmount = utils.parseEther('10000').add(1) // 10K + 1 wei

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.sync()
      expect(await asset.balanceOf(vault.address)).to.equal(1)

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.sync()
    })

    it('deposit on behalf', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(liquidator).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.sync()
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10000'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10000'))

      await expect(vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)).to.revertedWith('0x11')

      await vault.connect(user).approve(liquidator.address, utils.parseEther('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)
      await updateOracle()
      await vault.sync()

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('824128844013458')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(liquidator.address)).to.equal(utils.parseEther('190000'))
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('210000').add(fundingAmount))
    })

    it('redeem on behalf', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.sync()
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10000'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10000'))

      await expect(vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)).to.revertedWith('0x11')

      await vault.connect(user).approve(liquidator.address, utils.parseEther('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)
      await updateOracle()
      await vault.sync()

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('824128844013458')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
    })

    it('close to makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('400000'))
      await short.connect(perennialUser).openMake(utils.parseEther('480'))
      await updateOracle()
      await vault.sync()

      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.equal(
        largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice).div(1e12).div(1e12),
      )
      const makerLimitDelta = BigNumber.from('8282802043703935198')
      expect(await btcPosition()).to.equal(
        largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice).div(1e12).div(1e12),
      )
    })

    it('exactly at makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('400000'))
      const makerAvailable = (await short.makerLimit()).sub(
        (await short.positionAtVersion(await short['latestVersion()']())).maker,
      )

      await short.connect(perennialUser).openMake(makerAvailable)
      await updateOracle()
      await vault.sync()

      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.equal(
        largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice).div(1e12).div(1e12),
      )
      expect(await btcPosition()).to.equal(
        largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice).div(1e12).div(1e12),
      )
    })

    it('close to taker', async () => {
      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Get taker product very close to the maker
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('1000000'))
      await short.connect(perennialUser).openTake(utils.parseEther('1280'))
      await updateOracle()
      await vault.sync()

      // Redeem should create a greater position delta than what's available
      await vault.connect(user).redeem(utils.parseEther('4000'), user.address)
      await updateOracle()
      await vault.sync()

      const takerMinimum = BigNumber.from('6692251470872433151')
      expect(await shortPosition()).to.equal(takerMinimum)
      expect((await short.positionAtVersion(await short['latestVersion()']()))[0]).to.equal(
        (await short.positionAtVersion(await short['latestVersion()']()))[1],
      )
    })

    it('product closing closes all positions', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracleAndSync()

      expect(await position()).to.be.greaterThan(0)
      expect(await btcPosition()).to.be.greaterThan(0)
      const productOwner = await impersonate.impersonateWithBalance(
        await factory['owner(address)'](market.address),
        utils.parseEther('10'),
      )
      await market.connect(productOwner).updateClosed(true)
      await btcMarket.connect(owner).updateClosed(true)
      await updateOracleAndSync()
      await updateOracleAndSync()

      // We should have closed all positions
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      await market.connect(productOwner).updateClosed(false)
      await btcMarket.connect(owner).updateClosed(false)
      await updateOracleAndSync()
      await updateOracleAndSync()

      // Positions should be opened back up again
      expect(await position()).to.be.greaterThan(0)
      expect(await btcPosition()).to.be.greaterThan(0)
    })

    context('liquidation', () => {
      context('long', () => {
        it('recovers before being liquidated', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('4000'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 2. Settle accounts.
          // We should still not be able to deposit.
          await market.connect(user).settle(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 3. Sync the vault before it has a chance to get liquidated, it will work and no longer be liquidatable
          // We should still be able to deposit.
          await vault.sync()
          expect(await vault.maxDeposit(user.address)).to.equal('401972181441895951577804')
          await vault.connect(user).deposit(2, user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('4000'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 2. Settle accounts.
          // We should still not be able to deposit or redeem.
          await market.connect(user).settle(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 4. Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await collateral.connect(liquidator).liquidate(vault.address, market.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 5. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(utils.parseEther('3000'))
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.sync()

          const finalPosition = BigNumber.from('50707668091779666592')
          const finalCollateral = BigNumber.from('38030753919602731122977')
          const btcFinalPosition = BigNumber.from('1633897468743456266')
          const btcFinalCollateral = BigNumber.from('9507688479900682780744')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })

      context('short', () => {
        beforeEach(async () => {
          // get utilization closer to target in order to trigger pnl on price deviation
          await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
          await collateral
            .connect(perennialUser)
            .depositTo(perennialUser.address, market.address, utils.parseEther('120000'))
          await market.connect(perennialUser).openTake(utils.parseEther('700'))
          await collateral
            .connect(perennialUser)
            .depositTo(perennialUser.address, short.address, utils.parseEther('280000'))
          await short.connect(perennialUser).openTake(utils.parseEther('1100'))
          await updateOracle()
          await vault.sync()
        })

        it('recovers before being liquidated', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the short position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('1200'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 2. Settle accounts.
          // We should still not be able to deposit.
          await market.connect(user).settle(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 3. Sync the vault before it has a chance to get liquidated, it will work and no longer be liquidatable
          // We should still be able to deposit.
          await vault.sync()
          expect(await vault.maxDeposit(user.address)).to.equal('396777266765732414363890')
          await vault.connect(user).deposit(2, user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('1200'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 2. Settle accounts.
          // We should still not be able to deposit or redeem.
          await market.connect(user).settle(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 4. Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await collateral.connect(liquidator).liquidate(vault.address, short.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 5. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle()
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.sync()

          const finalPosition = BigNumber.from('136109459011782740553')
          const finalCollateral = BigNumber.from('40832846402925697101225')
          const btcFinalPosition = BigNumber.from('1754282213481988093')
          const btcFinalCollateral = BigNumber.from('10208211600731424275306')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })
    })

    context('insolvency', () => {
      beforeEach(async () => {
        // get utilization closer to target in order to trigger pnl on price deviation
        await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
        await collateral
          .connect(perennialUser)
          .depositTo(perennialUser.address, market.address, utils.parseEther('120000'))
        await market.connect(perennialUser).openTake(utils.parseEther('700'))
        await updateOracle()
        await vault.sync()
      })

      it('gracefully unwinds upon insolvency', async () => {
        // 1. Deposit initial amount into the vault
        await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
        await updateOracle()
        await vault.sync()

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).redeem(utils.parseEther('80000'), user.address)
        await updateOracle()
        await vault.sync()

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(utils.parseEther('20000'))
        await market.connect(user).settle(vault.address)
        await market.connect(perennialUser).closeTake(utils.parseEther('700'))
        await collateral.connect(liquidator).liquidate(vault.address, market.address)

        // // 4. Settle the vault to recover and rebalance
        await updateOracle() // let take settle at high price
        await updateOracle(utils.parseEther('1500')) // return to normal price to let vault rebalance
        await vault.sync()
        await updateOracle()
        await vault.sync()

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('23959832378187916303296')
        const btcFinalPosition = BigNumber.from('0')
        const btcFinalCollateral = BigNumber.from('5989958094546979075824')
        const finalUnclaimed = BigNumber.from('80000022114229307040353')
        expect(await position()).to.equal(finalPosition)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcPosition()).to.equal(btcFinalPosition)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(finalUnclaimed)
        expect(await vault.totalUnclaimed()).to.equal(finalUnclaimed)
        await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')

        // 6. Claim should be pro-rated
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.claim(user.address)
        expect(await collateralInVault()).to.equal(0)
        expect(await btcCollateralInVault()).to.equal(0)
        expect(await vault.unclaimed(user.address)).to.equal(0)
        expect(await vault.totalUnclaimed()).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(
          initialBalanceOf.add(finalCollateral.add(btcFinalCollateral).mul(2)).add(1),
        )

        // 7. Should no longer be able to deposit, vault is closed
        await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
      })
    })
  })
})