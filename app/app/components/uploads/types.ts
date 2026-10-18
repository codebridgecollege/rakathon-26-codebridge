// One row of UploadList: what the row shows, already worded by the screen that owns the list.
export type UploadListItem = {
  key: string | number;
  name: string;
  // Size and origin, for example "12 kB · MUDr. Svobodová, 09:05 · z telefonu".
  meta: string;
  chip: { text: string; cls: string; title?: string };
  // Present when the row may be removed.
  removable?: boolean;
  warnings?: string[];
};
