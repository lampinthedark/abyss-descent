#!/bin/bash
# Rebuilds assets/audio/medieval from the CC0 source packs (see CREDITS.md).
# Usage: SRC=/path/to/unzipped/packs scripts/build-audio.sh
#   $SRC/impact-sounds, $SRC/interface-sounds, $SRC/rpg-audio, $SRC/music-jingles  (kenney.nl zips)
#   $SRC/march.wav  (OpenGameArt "Epic March Loop", the_march_of_devils_dome_loop.wav)
# Output: mono .ogg (Vorbis) + .m4a (AAC) per clip; music loop crossfaded for a seamless wrap.
set -euo pipefail
SRC=${SRC:-/workspace/audio-src}
OUT=$(cd "$(dirname "$0")/.." && pwd)/assets/audio/medieval
mkdir -p "$OUT"
I="$SRC/impact-sounds/Audio"; U="$SRC/interface-sounds/Audio"; R="$SRC/rpg-audio/Audio"; J="$SRC/music-jingles/Audio/Pizzicato jingles"
# enc <name> <filter> <inputs...>: trims trailing silence, normalises peak, mono 44.1 kHz.
enc() {
  local name=$1 filt=$2; shift 2
  local args=(); for f in "$@"; do args+=(-i "$f"); done
  local chain="${filt},silenceremove=stop_periods=-1:stop_duration=0.08:stop_threshold=-55dB,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,aformat=channel_layouts=mono"
  ffmpeg -v error -y "${args[@]}" -filter_complex "$chain" -c:a libvorbis -q:a 1 "$OUT/$name.ogg"
  ffmpeg -v error -y "${args[@]}" -filter_complex "$chain" -c:a aac -b:a 48k "$OUT/$name.m4a"
}
one="[0:a]anull"
enc hit1 "$one" "$I/impactPunch_medium_000.ogg"
enc hit2 "$one" "$I/impactPunch_medium_002.ogg"
enc sword1 "$one" "$I/impactMetal_light_000.ogg"
enc sword2 "$one" "$I/impactMetal_light_002.ogg"
enc death1 "$one" "$I/impactWood_light_000.ogg"
enc death2 "$one" "$I/impactWood_light_003.ogg"
enc gem "$one" "$I/impactGlass_light_001.ogg"
enc level "$one" "$J/jingles_PIZZI16.ogg"
enc chest "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0" "$R/metalLatch.ogg" "$R/handleCoins.ogg"
# Boss entrance: heavy bell an octave down with a long echo, under a heavy metal strike.
enc boss "[0:a]asetrate=24255,aresample=44100,aecho=0.8:0.7:180|420:0.45|0.3[a];[1:a]asetrate=30870,aresample=44100[b];[a][b]amix=inputs=2:duration=longest:normalize=0" "$I/impactBell_heavy_000.ogg" "$I/impactMetal_heavy_000.ogg"
enc warn "[0:a]asetrate=35280,aresample=44100" "$U/bong_001.ogg"
enc hurt "$one" "$I/impactPunch_heavy_000.ogg"
enc ui "$one" "$U/click_002.ogg"
enc victory "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0" "$J/jingles_PIZZI02.ogg" "$I/impactBell_heavy_001.ogg"
enc defeat "[0:a]asetrate=37485,aresample=44100" "$J/jingles_PIZZI01.ogg"
enc swing "$one" "$R/knifeSlice.ogg"
enc cast "$one" "$R/drawKnife2.ogg"
enc talk "$one" "$R/bookFlip1.ogg"
# Music: 0.5 s crossfade of the tail into the head, so the loop wraps without a seam.
L=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC/march.wav")
X=0.5
B=$(python3 -c "print(round($L-$X,4))")
mf="[0:a]aformat=channel_layouts=mono,asplit[h][t];[h]atrim=0:$B,asetpts=PTS-STARTPTS,afade=t=in:d=$X:curve=qsin[body];[t]atrim=$B:$L,asetpts=PTS-STARTPTS,afade=t=out:d=$X:curve=qsin[tail];[body][tail]amix=inputs=2:duration=first:normalize=0,volume=0.9"
ffmpeg -v error -y -i "$SRC/march.wav" -filter_complex "$mf" -ar 44100 -c:a libvorbis -q:a 0 "$OUT/music.ogg"
ffmpeg -v error -y -i "$SRC/march.wav" -filter_complex "$mf" -ar 44100 -c:a aac -b:a 64k "$OUT/music.m4a"
echo "loop length: $B s"
ls -l "$OUT"
