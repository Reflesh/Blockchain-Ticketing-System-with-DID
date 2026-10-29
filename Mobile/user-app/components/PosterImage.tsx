import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { TICKET_WEB_URL } from '@/constants/api';

export function resolvePosterUri(uri: string): string | null {
  if (!uri?.trim()) return null;
  try {
    const url = new URL(uri.trim(), `${TICKET_WEB_URL.replace(/\/$/, '')}/`);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function PosterImage({
  uri,
  style,
  overlayColor,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  overlayColor?: string;
}) {
  const [failed, setFailed] = useState(false);
  const sourceUri = resolvePosterUri(uri);

  useEffect(() => setFailed(false), [uri]);

  if (!sourceUri || failed) return null;

  return (
    <>
      <Image
        source={sourceUri}
        style={style}
        contentFit="cover"
        transition={180}
        onError={() => setFailed(true)}
      />
      {overlayColor && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: overlayColor }]} />
      )}
    </>
  );
}
