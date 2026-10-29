const fs = require('node:fs');
const path = require('node:path');

module.exports = function withNetworkPolicy(config, { hostname, allowHttp }) {
  // Resolve each project's own Expo SDK, keeping both apps independently buildable.
  const { withAndroidManifest, withDangerousMod } = require(require.resolve('expo/config-plugins', { paths: [config._internal.projectRoot] }));
  config = withAndroidManifest(config, result => {
    const application = result.modResults.manifest.application[0];
    application.$['android:usesCleartextTraffic'] = 'false';
    application.$['android:networkSecurityConfig'] = '@xml/ticketpro_network_security';
    return result;
  });
  return withDangerousMod(config, ['android', async result => {
    if (!/^[a-z0-9.-]+$/i.test(hostname)) throw new Error('Invalid API hostname');
    const directory = path.join(result.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'ticketpro_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  ${allowHttp ? `<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">${hostname}</domain></domain-config>` : ''}
</network-security-config>
`);
    return result;
  }]);
};
