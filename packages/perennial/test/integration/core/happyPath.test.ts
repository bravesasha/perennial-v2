import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, INITIAL_VERSION } from '../helpers/setupHelpers'
import { createPayoffDefinition, expectPositionEq } from '../../../../common/testutil/types'
import { Market__factory } from '../../../types/generated'

//TODO: gas -> make sure all fees are non-zero (maker / taker / position)
//TODO: gas -> a/b/c settle where both versions have non-zero position

describe.only('Happy Path', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('creates a market', async () => {
    const { owner, controller, treasuryB, contractPayoffProvider, chainlinkOracle, dsu, rewardToken } = instanceVars

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      reward: rewardToken.address,
      payoffDefinition: createPayoffDefinition({ contractAddress: contractPayoffProvider.address }),
      oracle: chainlinkOracle.address,
    }
    const parameter = {
      maintenance: utils.parseEther('0.3'),
      fundingFee: utils.parseEther('0.1'),
      makerFee: 0,
      takerFee: 0,
      positionFee: 0,
      makerLimit: utils.parseEther('1'),
      closed: true,
      utilizationCurve: {
        minRate: 0,
        maxRate: utils.parseEther('5.00'),
        targetRate: utils.parseEther('0.80'),
        targetUtilization: utils.parseEther('0.80'),
      },
      rewardRate: {
        _maker: 0,
        _taker: 0,
      },
    }
    const marketAddress = await controller.callStatic.createMarket(definition, parameter)
    await expect(controller.createMarket(definition, parameter)).to.emit(controller, 'MarketCreated')
    const market = Market__factory.connect(marketAddress, owner)
    await market.connect(owner).acceptOwner()
    await market.connect(owner).updateTreasury(treasuryB.address)
  })

  it('opens a make position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL)

    await expect(market.connect(user).update(POSITION.mul(-1), COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.mul(-1), COLLATERAL)

    // Check user is in the correct state
    expect((await market.accounts(user.address))._position).to.equal(0)
    expect((await market.accounts(user.address))._next).to.equal(POSITION.mul(-1).div(1e12))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION.div(1e12),
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await market.position(), {
      _maker: POSITION.div(1e12),
      _taker: 0,
      _makerNext: POSITION.div(1e12),
      _takerNext: 0,
    })

    // Settle user and check state
    await market.settle(user.address)
    expect((await market.accounts(user.address))._position).to.equal(POSITION.mul(-1).div(1e12))
    expect((await market.accounts(user.address))._next).to.equal(POSITION.mul(-1).div(1e12))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('opens multiple make positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL)

    await market.connect(user).update(POSITION.div(2).mul(-1), COLLATERAL)

    await expect(market.connect(user).update(POSITION.mul(-1), COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.mul(-1), COLLATERAL)

    // Check user is in the correct state
    expect((await market.accounts(user.address))._position).to.equal(0)
    expect((await market.accounts(user.address))._next).to.equal(POSITION.mul(-1).div(1e12))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION.div(1e12),
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await market.position(), {
      _maker: POSITION.div(1e12),
      _taker: 0,
      _makerNext: POSITION.div(1e12),
      _takerNext: 0,
    })

    // Settle user and check state
    await market.settle(user.address)
    expect((await market.accounts(user.address))._position).to.equal(POSITION.mul(-1).div(1e12))
    expect((await market.accounts(user.address))._next).to.equal(POSITION.mul(-1).div(1e12))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('closes a make position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL)

    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await expect(market.connect(user).update(0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, 0, COLLATERAL)

    // User state
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, market.address)).to.equal(0)
    expect((await market.accounts(user.address))._position).to.equal(0)
    expect((await market.accounts(user.address))._next).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: 0,
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })

  it('closes multiple make positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL)

    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(user).update(POSITION.div(2).mul(-1), COLLATERAL)

    await expect(market.connect(user).update(0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, 0, COLLATERAL)

    // User state
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, market.address)).to.equal(0)
    expect((await market.accounts(user.address))._position).to.equal(0)
    expect((await market.accounts(user.address))._next).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: 0,
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })

  it('opens a take position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const POSITION_B = utils.parseEther('0.00001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL)
    await dsu.connect(userB).approve(market.address, COLLATERAL)

    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await expect(market.connect(userB).update(POSITION_B, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, POSITION_B, COLLATERAL)

    // User State
    expect((await market.accounts(userB.address))._position).to.equal(0)
    expect((await market.accounts(userB.address))._next).to.equal(POSITION_B.div(1e12))
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION.div(1e12),
      _takerNext: POSITION_B.div(1e12),
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(constants.AddressZero)

    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      _maker: POSITION.div(1e12),
      _taker: POSITION_B.div(1e12),
      _makerNext: POSITION.div(1e12),
      _takerNext: POSITION_B.div(1e12),
    })
    await market.settle(userB.address)
    expect((await market.accounts(userB.address))._position).to.equal(POSITION_B.div(1e12))
    expect((await market.accounts(userB.address))._next).to.equal(POSITION_B.div(1e12))
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('opens multiple take positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const POSITION_B = utils.parseEther('0.00001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL)
    await dsu.connect(userB).approve(market.address, COLLATERAL)

    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION_B.div(2), COLLATERAL)

    await expect(market.connect(userB).update(POSITION_B, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, POSITION_B, COLLATERAL)

    // User State
    expect((await market.accounts(userB.address))._position).to.equal(0)
    expect((await market.accounts(userB.address))._next).to.equal(POSITION_B.div(1e12))
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION.div(1e12),
      _takerNext: POSITION_B.div(1e12),
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(constants.AddressZero)

    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      _maker: POSITION.div(1e12),
      _taker: POSITION_B.div(1e12),
      _makerNext: POSITION.div(1e12),
      _takerNext: POSITION_B.div(1e12),
    })
    await market.settle(userB.address)
    expect((await market.accounts(userB.address))._position).to.equal(POSITION_B.div(1e12))
    expect((await market.accounts(userB.address))._next).to.equal(POSITION_B.div(1e12))
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('closes a take position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const POSITION_B = utils.parseEther('0.00001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, userB, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL)
    await dsu.connect(userB).approve(market.address, COLLATERAL)

    await expect(market.connect(userB).update(POSITION_B, COLLATERAL)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION_B, COLLATERAL)

    await expect(market.connect(userB).update(0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, 0, COLLATERAL)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, market.address)).to.equal(0)
    expect((await market.accounts(userB.address))._position).to.equal(0)
    expect((await market.accounts(userB.address))._next).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION.div(1e12),
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })

  it('closes multiple take positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const POSITION_B = utils.parseEther('0.00001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, userB, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL)
    await dsu.connect(userB).approve(market.address, COLLATERAL)

    await expect(market.connect(userB).update(POSITION_B, COLLATERAL)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION_B, COLLATERAL)
    await market.connect(userB).update(POSITION_B.div(2).mul(-1), COLLATERAL)

    await expect(market.connect(userB).update(0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, 0, COLLATERAL)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, market.address)).to.equal(0)
    expect((await market.accounts(userB.address))._position).to.equal(0)
    expect((await market.accounts(userB.address))._next).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION.div(1e12),
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })

  it('settle no op (gas test)', async () => {
    const { user } = instanceVars

    const market = await createMarket(instanceVars)

    await market.settle(user.address)
    await market.settle(user.address)
  })

  it('disables actions when paused', async () => {
    const { controller, pauser, user } = instanceVars
    const market = await createMarket(instanceVars)

    await expect(controller.connect(pauser).updatePaused(true)).to.emit(controller, 'ParameterUpdated')
    await expect(market.update(0, utils.parseEther('1000'))).to.be.revertedWith('PausedError()')
    await expect(market.liquidate(user.address)).to.be.revertedWith('PausedError()')
    await expect(market.update(utils.parseEther('0.001'), 0)).to.be.revertedWith('PausedError()')
    await expect(market.settle(user.address)).to.be.revertedWith('PausedError()')
  })

  it('delayed update w/ collateral (gas)', async () => {
    const positionFeesOn = true
    const incentizesOn = false

    const parameter = {
      maintenance: utils.parseEther('0.3'),
      fundingFee: utils.parseEther('0.1'),
      makerFee: positionFeesOn ? utils.parseEther('0.001') : 0,
      takerFee: positionFeesOn ? utils.parseEther('0.001') : 0,
      positionFee: positionFeesOn ? utils.parseEther('0.1') : 0,
      makerLimit: utils.parseEther('1'),
      closed: false,
      utilizationCurve: {
        minRate: 0,
        maxRate: utils.parseEther('5.00'),
        targetRate: utils.parseEther('0.80'),
        targetUtilization: utils.parseEther('0.80'),
      },
      rewardRate: {
        _maker: incentizesOn ? utils.parseEther('0.01') : 0,
        _taker: incentizesOn ? utils.parseEther('0.001') : 0,
      },
    }

    const POSITION = utils.parseEther('0.0001')
    const COLLATERAL = utils.parseEther('1000')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(2))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(2))

    await market.connect(user).update(POSITION.div(3).mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION.div(3), COLLATERAL)

    await chainlink.next()
    await chainlink.next()

    await market.connect(user).update(POSITION.div(2).mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION.div(2), COLLATERAL)

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(market.connect(user).update(POSITION.mul(-1), COLLATERAL.sub(1)))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 4, POSITION.mul(-1), COLLATERAL.sub(1))

    // Check user is in the correct state
    expect((await market.accounts(user.address))._position).to.equal(POSITION.div(2).mul(-1).div(1e12))
    expect((await market.accounts(user.address))._next).to.equal(POSITION.mul(-1).div(1e12))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 4)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 4)
    expectPositionEq(await market.position(), {
      _maker: POSITION.div(2).div(1e12),
      _taker: POSITION.div(2).div(1e12),
      _makerNext: POSITION.div(1e12),
      _takerNext: POSITION.div(2).div(1e12),
    })
    const version = await market.versions(INITIAL_VERSION + 4)
    expect(version._makerValue).to.equal('-357213762097')
    expect(version._takerValue).to.equal('367430826479')
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })
})
