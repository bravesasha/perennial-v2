import { utils } from 'ethers'

export const cmsqETHOracleID = utils.id('oracle-cmsq-eth')
export const msqBTCOracleID = utils.id('oracle-msq-btc')

export const DEFAULT_PROTOCOL_PARAMETER = {
  protocolFee: 0,
  maxFee: utils.parseUnits('0.002', 6), // 0.2%
  maxFeeAbsolute: utils.parseUnits('50', 6), // $50
  maxCut: utils.parseUnits('0.1', 6), // 10%
  maxRate: utils.parseUnits('5.00', 6), // 500%
  minMaintenance: utils.parseUnits('0.004', 6), // 0.4%
  minEfficiency: utils.parseUnits('0.25', 6), // 25%
  referralFee: 0,
}

export const DEFAULT_MARKET_PARAMETER = {
  fundingFee: utils.parseUnits('0.05', 6),
  interestFee: utils.parseUnits('0.05', 6),
  positionFee: utils.parseUnits('0.05', 6),
  oracleFee: 0,
  riskFee: utils.parseUnits('1', 6),
  maxPendingGlobal: 12,
  maxPendingLocal: 6,
  settlementFee: utils.parseUnits('1.5', 6),
  makerCloseAlways: false,
  takerCloseAlways: true,
  closed: false,
  settle: false,
}

export const DEFAULT_RISK_PARAMETERS = {
  margin: utils.parseUnits('0.0095', 6),
  maintenance: utils.parseUnits('0.008', 6),
  takerFee: {
    linearFee: utils.parseUnits('0.0002', 6),
    proportionalFee: utils.parseUnits('0.001', 6),
    adiabaticFee: 0,
    scale: utils.parseUnits('1', 6),
  },
  makerFee: {
    linearFee: utils.parseUnits('0.0001', 6),
    proportionalFee: 0,
    adiabaticFee: 0,
    scale: utils.parseUnits('1', 6),
  },
  makerLimit: utils.parseUnits('1', 6),
  efficiencyLimit: utils.parseUnits('0.5', 6),
  liquidationFee: utils.parseUnits('0.05', 6),
  utilizationCurve: {
    minRate: 0,
    maxRate: utils.parseUnits('0.155', 6),
    targetRate: utils.parseUnits('0.055', 6),
    targetUtilization: utils.parseUnits('0.60', 6),
  },
  pController: {
    k: utils.parseUnits('20000', 6),
    min: utils.parseUnits('-2.50', 6),
    max: utils.parseUnits('2.50', 6),
  },
  minMargin: utils.parseUnits('10', 6),
  minMaintenance: utils.parseUnits('10', 6),
  staleAfter: 7200,
  makerReceiveOnly: false,
}
