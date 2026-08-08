const transformIgnorePatterns = require('@tn4consulting/shared-platform-standards/configs/jest.transform-ignore.cjs');

module.exports = {
  displayName: 'job-bank-data-access',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/libs/data-access',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  transformIgnorePatterns,
};
