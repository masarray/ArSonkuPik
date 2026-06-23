# Audio Engine Notes

ArSonKuPik is tuned as a browser mastering-style enhancer, not a professional offline mastering replacement.

## EQ

The EQ is used for tonal shaping, cleanup, and smart preset tone targets.

## Compressor

The compressor is designed for musical glue, not heavy pumping. Presets should avoid excessive makeup gain because many streaming sources are already mastered loud.

## Color Harmonics

The color stage uses analog-style parallel processing. The goal is to add:

- Low punch and weight without blunting kick attack
- Warm body in vocal and instrument fundamentals
- Pleasant mid presence without harshness
- Silky high-frequency brightness without brittle distortion

## Stereo Width

The width stage follows a multiband imager concept:

- Low frequencies remain conservative and mono-safe.
- Low-mid widening is limited to protect body and vocal solidity.
- Mid range is widened carefully.
- High-frequency side energy gets the most sparkle.

This prevents the common full-band widening problem where vocals lose center weight and bass loses impact.

## Visual Engine

Meters and spectrum visuals should feel fluid without consuming unnecessary CPU. The Studio UI uses low-rate analysis plus animation smoothing so the user sees continuous motion while the audio engine remains stable.
