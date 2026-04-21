import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'vkyc',
  outputTargets: [
    {
      type: 'dist',
      esmLoaderPath: '../loader',
    },
    {
      type: 'dist-custom-elements',
      customElementsExportBehavior: 'auto-define-custom-elements',
    },
    {
      type: 'www',
      serviceWorker: null,
      baseUrl: 'https://sayanch83.github.io/vkyc-work-ui/',
    },
  ],
  testing: {
    browserHeadless: 'new',
  },
};
