declare module "shpjs" {
  const parse: (input: ArrayBuffer | Uint8Array) => Promise<unknown>;
  export default parse;
}
