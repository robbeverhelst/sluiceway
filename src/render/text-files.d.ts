// A shell script imported as its text, which the bundle carries.
declare module "*.sh" {
  const text: string;
  export default text;
}
