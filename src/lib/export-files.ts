export function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let n = 0; n < decoded.length; n++) bytes[n] = decoded.charCodeAt(n);
  return bytes;
}
export function saveBinaryFile(file: { filename: string; mime: string; dataBase64: string }) {
  saveBlob(file.filename, new Blob([fromBase64(file.dataBase64)], { type: file.mime }));
}
