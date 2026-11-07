/* Crown Tools - reads the text in a card photo, right here on your device. Nothing is uploaded.
   Uses the Tesseract OCR engine (tesseract.js-core 7.0.0, Apache-2.0) with the English "fast" model (tessdata_fast,
   Apache-2.0). Messages in: { id, image: Uint8Array (PNG/JPEG), psm, digits }. Messages out: { id, text } or { id, error }. */
'use strict';
let ready = null;
// a tiny module that uses a SIMD instruction: if the browser accepts it, use the faster SIMD build
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
function load() {
  if (ready) return ready;
  ready = (async () => {
    let simd = false;
    try { simd = WebAssembly.validate(SIMD_TEST); } catch (e) { simd = false; }
    const core = simd ? 'tesseract-core-simd-lstm' : 'tesseract-core-lstm';
    importScripts(core + '.js');
    const M = await self.TesseractCore({ locateFile: f => f });
    const r = await fetch('eng.traineddata');
    if (!r.ok) throw new Error('Couldn’t load the text reader (' + r.status + ').');
    M.FS.writeFile('./eng.traineddata', new Uint8Array(await r.arrayBuffer()));
    const api = new M.TessBaseAPI();
    if (api.Init(null, 'eng', 1) === -1) throw new Error('The text reader didn’t start.');
    return { M, api };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}
self.onmessage = async e => {
  const { id, image, psm, digits } = e.data || {};
  try {
    const { M, api } = await load();
    if (id === 'warm') { self.postMessage({ id, text: '' }); return; }
    api.SetVariable('tessedit_pageseg_mode', String(psm || 11));
    api.SetVariable('user_defined_dpi', '300');
    api.SetVariable('tessedit_char_whitelist', digits ? '0123456789 ' : ''); // digits only: no letters to mistake for numbers
    M.FS.writeFile('/input', image);
    if (api.SetImageFile(1, 0) === 1) throw new Error('Couldn’t read that picture.');
    const text = api.GetUTF8Text();
    api.Clear();
    self.postMessage({ id, text });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
