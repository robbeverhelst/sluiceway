// Where the dashboard's images come from (record 0033): the public action
// repo, at the exact release tag of the running action or its commit SHA,
// never a moving tag, so a file never changes behind its address.

const ACTION_REPO = "sluiceway/sluiceway";

// One piece of a url inside a Markdown link. `encodeURIComponent` leaves
// `( ) * ! ' ~` alone, and a closing bracket would end the link early.
export function urlPart(text: string): string {
  return encodeURIComponent(text).replace(
    /[()*!'~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// One file of `assets/mascot/`, such as `pending-2-dark.svg`.
export function mascotUrl(actionRef: string, file: string): string {
  return `https://raw.githubusercontent.com/${ACTION_REPO}/${urlPart(actionRef)}/assets/mascot/${file}`;
}
