const path = require('node:path');

module.exports = function configureApp(config, role) {
  const origin = new URL(process.env.TICKETPRO_PUBLIC_URL || 'https://ticketpro.duckdns.org');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('TICKETPRO_PUBLIC_URL must be an HTTP(S) origin without a path.');
  }
  const allowHttp = process.env.TICKETPRO_HTTP_DEMO === '1';
  if (process.env.TICKETPRO_BUILD_MODE === 'release' && origin.protocol === 'http:' && !allowHttp) {
    throw new Error('HTTP demo builds require explicit TICKETPRO_HTTP_DEMO=1.');
  }
  const user = role === 'user';
  const plugins = (config.plugins || []).filter(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-camera');
  plugins.push(['expo-camera', {
    cameraPermission: user ? '모바일 연결 QR을 스캔하기 위해 카메라를 사용합니다.' : '티켓 QR을 검증하기 위해 카메라를 사용합니다.',
    recordAudioAndroid: false,
  }]);
  if (user && !plugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-secure-store')) plugins.push('expo-secure-store');
  plugins.push([path.join(__dirname, 'withNetworkPolicy'), { hostname: origin.hostname, allowHttp: allowHttp && origin.protocol === 'http:' }]);
  return {
    ...config,
    name: user ? 'TicketPro' : 'TicketPro Admin',
    android: {
      ...config.android,
      package: user ? 'com.ticketpro.demo.user' : 'com.ticketpro.demo.admin',
      versionCode: Number(process.env.TICKETPRO_VERSION_CODE || 2),
      allowBackup: false,
      blockedPermissions: [...new Set([...(config.android?.blockedPermissions || []), 'android.permission.RECORD_AUDIO'])],
    },
    plugins,
    extra: { ...config.extra, ticketproPublicUrl: origin.origin,
      ticketproWebUrl: process.env.EXPO_PUBLIC_TICKET_WEB_URL || (origin.protocol === 'http:' && origin.port === '8000' ? `${origin.protocol}//${origin.hostname}:5173` : origin.origin),
      ticketproApiUrl: `${origin.origin}/api` },
  };
};
