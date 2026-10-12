// One-off: pulls candidate landscape photos per province from Wikimedia Commons
// (free licences only) into tmp-province-photos/ so one can be picked for each.
import { mkdir, writeFile } from "node:fs/promises";

const Q = {
  WC: ["Table Mountain Bloubergstrand", "Cape Point lighthouse cliffs", "Cederberg mountains"],
  EC: ["Hole in the Wall Wild Coast", "Tsitsikamma Storms River mouth", "Wild Coast Coffee Bay"],
  KZN: ["Drakensberg Amphitheatre", "Royal Natal National Park Tugela", "Sani Pass Drakensberg"],
  GP: ["Johannesburg skyline Hillbrow Tower", "Johannesburg skyline sunset", "Cradle of Humankind landscape"],
  LP: ["Baobab Mapungubwe", "Limpopo baobab tree landscape", "Kruger National Park Limpopo"],
  MP: ["Three Rondavels Blyde River Canyon", "Blyde River Canyon", "God's Window Mpumalanga"],
  NW: ["Pilanesberg National Park landscape", "Magaliesberg mountains", "Pilanesberg elephants"],
  FS: ["Golden Gate Highlands National Park", "Brandwag Golden Gate", "Clarens Free State mountains"],
  NC: ["Namaqualand flowers daisies", "Quiver tree forest Kenhardt", "Augrabies Falls"],
};
const OK = /^(CC0|Public domain|CC BY(-SA)? [0-9.]+)/i;
const UA = { "User-Agent": "ScrumlineProvincePhotos/1.0 (github.com/jdaines89/scrumline)" };
const strip = (s) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

await mkdir("tmp-province-photos", { recursive: true });
const meta = [];
for (const [code, qs] of Object.entries(Q)) {
  let n = 0;
  for (const q of qs) {
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    Object.entries({ action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "6",
      gsrsearch: `${q} filetype:bitmap`, prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "960" })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    const d = await (await fetch(u, { headers: UA })).json();
    const pages = Object.values(d.query?.pages ?? {}).sort((a, b) => a.index - b.index);
    let took = 0;
    for (const p of pages) {
      const i = p.imageinfo?.[0]; const m = i?.extmetadata ?? {};
      const lic = strip(m.LicenseShortName?.value);
      if (!i || !OK.test(lic) || i.width < 1200 || i.width < i.height * 1.2) continue;
      const file = `${code}-${++n}.jpg`;
      const img = await fetch(i.thumburl, { headers: UA });
      if (!img.ok) continue;
      await writeFile(`tmp-province-photos/${file}`, Buffer.from(await img.arrayBuffer()));
      meta.push({ code, file, title: p.title, page: i.descriptionurl, licence: lic, artist: strip(m.Artist?.value) });
      if (++took >= 2) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
await writeFile("tmp-province-photos/meta.json", JSON.stringify(meta, null, 2));
console.log(`${meta.length} photos`);
