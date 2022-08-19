import { dirname } from 'path'

import defaultConfig from '../common/hardhat.default.config'
const eqPerennialDir = dirname(require.resolve('@equilibria/perennial/package.json'))
const eqPerennialOracleDir = dirname(require.resolve('@equilibria/perennial-oracle/package.json'))

const config = defaultConfig({
  externalDeployments: {
    kovan: [`${eqPerennialDir}/deployments/kovan`, `${eqPerennialOracleDir}/deployments/kovan`],
    mainnet: [`${eqPerennialDir}/deployments/mainnet`, `${eqPerennialOracleDir}/deployments/mainnet`],
    hardhat: [`${eqPerennialDir}/deployments/mainnet`, `${eqPerennialOracleDir}/deployments/mainnet`],
    localhost: [`${eqPerennialDir}/deployments/localhost`, `${eqPerennialOracleDir}/deployments/localhost`],
  },
  dependencyPaths: ['@equilibria/perennial/contracts/interfaces/IController.sol'],
})

export default config