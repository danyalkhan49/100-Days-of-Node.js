const { validateProductionConfig } = require('../utils/productionConfig');

function main() {
  const errors = validateProductionConfig();
  if (errors.length) {
    console.error('Production configuration check failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Production configuration check passed.');
}

if (require.main === module) main();

module.exports = { validateProductionConfig };
