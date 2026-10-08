// Point mapUrl at a private JSON frame map to swap the placeholder art
// without changing the renderer. Leave both null to use the original
// placeholders described by assets/3d/atlas/placeholders.json.
//
// A remote map looks like:
//   { "image": "https://host/atlas.png", "frames": { "hero/legs/base/walk/0/0": { "x":0,"y":0,"w":64,"h":72,"footX":32,"footY":2 } } }
// footY is pixels up from the bottom of the frame.
// Frame ids are "{sheet}/{anim}/{dir}/{frame}". Sheets and anims are listed
// in the placeholder map. Explicit frames win over the grid packing.

export const atlasConfig = {
  mapUrl: null,
  imageUrl: null,
};
