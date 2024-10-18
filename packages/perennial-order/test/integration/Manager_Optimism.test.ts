import { expect } from 'chai'
import { BigNumber, CallOverrides, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'

import {
  IEmptySetReserve__factory,
  IERC20Metadata,
  IERC20Metadata__factory,
  IManager,
  IMarket,
  IMarketFactory,
  Manager_Optimism__factory,
  OptGasInfo,
  OrderVerifier__factory,
} from '../../types/generated'
import { impersonate } from '../../../common/testutil'

import { parse6decimal } from '../../../common/testutil/types'
import { transferCollateral } from '../helpers/marketHelpers'
import { createMarketETH, deployProtocol, deployPythOracleFactory, FixtureVars } from '../helpers/setupHelpers'
import { RunManagerTests } from './Manager.test'

const { ethers } = HRE

const DSU_ADDRESS = '0x7b4Adf64B0d60fF97D672E473420203D52562A84' // Digital Standard Unit, an 18-decimal token
const DSU_RESERVE = '0x5FA881826AD000D010977645450292701bc2f56D'
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC, a 6-decimal token, used by DSU reserve above
const USDC_HOLDER = '0xF977814e90dA44bFA03b6295A0616a897441aceC' // EOA has 302mm USDC at height 21067741

const PYTH_ADDRESS = '0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a'

const CHAINLINK_ETH_USD_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'

export async function fundWalletDSU(
  wallet: SignerWithAddress,
  amount: BigNumber,
  overrides?: CallOverrides,
): Promise<undefined> {
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, wallet)
  const reserve = IEmptySetReserve__factory.connect(DSU_RESERVE, wallet)
  const balanceBefore = await dsu.balanceOf(wallet.address)

  // fund wallet with USDC and then mint using reserve
  await fundWalletUSDC(wallet, amount.div(1e12), overrides)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, wallet)
  await usdc.connect(wallet).approve(reserve.address, amount.div(1e12))
  await reserve.mint(amount)

  expect((await dsu.balanceOf(wallet.address)).sub(balanceBefore)).to.equal(amount)
}

async function fundWalletUSDC(
  wallet: SignerWithAddress,
  amount: BigNumber,
  overrides?: CallOverrides,
): Promise<undefined> {
  const usdcOwner = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, usdcOwner)

  expect(await usdc.balanceOf(USDC_HOLDER)).to.be.greaterThan(amount)
  await usdc.transfer(wallet.address, amount, overrides ?? {})
}

// prepares an account for use with the market and manager
async function setupUser(
  dsu: IERC20Metadata,
  marketFactory: IMarketFactory,
  market: IMarket,
  manager: IManager,
  user: SignerWithAddress,
  amount: BigNumber,
) {
  // funds, approves, and deposits DSU into the market
  await fundWalletDSU(user, amount.mul(1e12))
  await dsu.connect(user).approve(market.address, amount.mul(1e12))
  await transferCollateral(user, market, amount)

  // allows manager to interact with markets on the user's behalf
  await marketFactory.connect(user).updateOperator(manager.address, true)
}

const fixture = async (): Promise<FixtureVars> => {
  // deploy the protocol and create a market
  const [owner, userA, userB, userC, userD, keeper, oracleFeeReceiver] = await ethers.getSigners()
  const [marketFactory, dsu, oracleFactory] = await deployProtocol(owner, DSU_ADDRESS)
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, owner)
  const reserve = IEmptySetReserve__factory.connect(DSU_RESERVE, owner)
  const pythOracleFactory = await deployPythOracleFactory(owner, oracleFactory, PYTH_ADDRESS, CHAINLINK_ETH_USD_FEED)
  const [market, oracle, keeperOracle] = await createMarketETH(
    owner,
    oracleFactory,
    pythOracleFactory,
    marketFactory,
    dsu,
  )

  // deploy the order manager
  const verifier = await new OrderVerifier__factory(owner).deploy(marketFactory.address)
  const manager = await new Manager_Optimism__factory(owner).deploy(
    USDC_ADDRESS,
    dsu.address,
    DSU_RESERVE,
    marketFactory.address,
    verifier.address,
  )

  const keepConfig = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 1_000_000, // buffer for withdrawing keeper fee from market
    multiplierCalldata: 0,
    bufferCalldata: 0,
  }
  const keepConfigBuffered = {
    multiplierBase: ethers.utils.parseEther('1'),
    bufferBase: 1_000_000, // for price commitment
    multiplierCalldata: ethers.utils.parseEther('1'),
    bufferCalldata: 0,
  }
  await manager.initialize(CHAINLINK_ETH_USD_FEED, keepConfig, keepConfigBuffered)

  // TODO: can user setup be handled by the test in such a way that the test calls loadFixture
  // after some nested setup?
  // fund accounts and deposit all into market
  const amount = parse6decimal('100000')
  await setupUser(dsu, marketFactory, market, manager, userA, amount)
  await setupUser(dsu, marketFactory, market, manager, userB, amount)
  await setupUser(dsu, marketFactory, market, manager, userC, amount)
  await setupUser(dsu, marketFactory, market, manager, userD, amount)

  return {
    dsu,
    usdc,
    reserve,
    keeperOracle,
    manager,
    marketFactory,
    market,
    oracle,
    verifier,
    owner,
    userA,
    userB,
    userC,
    userD,
    keeper,
    oracleFeeReceiver,
  }
}

async function getFixture(): Promise<FixtureVars> {
  const vars = loadFixture(fixture)
  return vars
}

async function mockGasInfo() {
  const gasInfo = await smock.fake<OptGasInfo>('OptGasInfo', {
    address: '0x420000000000000000000000000000000000000F',
  })
  gasInfo.getL1GasUsed.returns(1600)
  gasInfo.l1BaseFee.returns(18476655731)
  gasInfo.baseFeeScalar.returns(2768304)
  gasInfo.decimals.returns(6)
}

if (process.env.FORK_NETWORK === 'base') RunManagerTests('Manager_Optimism', getFixture, mockGasInfo)
