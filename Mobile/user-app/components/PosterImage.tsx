import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';

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

  useEffect(() => setFailed(false), [uri]);

  if (!uri || failed) return null;

  return (
    <>
      <Image
        source={uri}
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