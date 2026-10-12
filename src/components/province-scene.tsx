const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** What each province's picture shows, for screen readers. */
const LABELS: Record<string, string> = {
  EC: "Aloes on the Eastern Cape coast",
  FS: "Free State plains and a flat-topped mountain",
  GP: "The Johannesburg skyline at dusk",
  KZN: "The Drakensberg above a KwaZulu-Natal beach",
  LP: "A baobab in the Limpopo bushveld at sunset",
  MP: "A waterfall in the Blyde River Canyon",
  NW: "A gemsbok under a thorn tree in the North West",
  NC: "A quiver tree and red rocks in the Northern Cape",
  WC: "Table Mountain and a king protea",
};

/**
 * A picture of each province behind its row on the provinces table, fading in
 * from the right. Absolutely placed, so the row's height never depends on it.
 */
export function ProvinceScene({ code }: { code: string }) {
  const label = LABELS[code];
  if (!label) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="pscene" src={`${base}/provinces/${code.toLowerCase()}.webp`} alt={label} width={512} height={341} decoding="async" />;
}
