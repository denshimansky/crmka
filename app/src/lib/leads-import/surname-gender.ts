// Согласование фамилии родителя с его полом, определённым по имени.
// Порт логики из import/build_leads.py.

const FEMALE_NAMES_RAW = `
александра анастасия анастастия анна анжела анжелика антонина алёна алена алина алия аля
алла алеся альбина альфия альмира альфина анфиса ангелина аделя айгуль айгель айзиря айсель
айсылу айстолу алевтина алиса алися алсу амира амина амелина арзу арина арсения аэлита аида
варвара варя василиса вафа венера вера вероника виктория виолетта вита виля влада валентина
валерия галина галия гелия геллия гелюся гузель гузеля гузял гуля гульназ гульназа гульнара
гульфия гульмира гулина гельназ гельсиня гельфия гильфия глахиаз дана дания дарья дария
джемма джамиля диана дианна дина динара диляра дурсуна ева евгения екатерина елена елизавета
жанна зарима зарина зимфира зинаида зиля зиза зифа зухра зоя зуля ирина илона индира инна
инга ильмира ильвира ильнара ильнура ираида карина катерина катя кадрия камилла клара клавдия
кристина ксения ксюша курбонби лариса лейла лейсан лейсана лейсян ляйсан ляйсян лэйсен лиана
лидия лика лилия лиля лилиля линара леся любовь люба людмила люсьен люсьена люция лерина
мадина маргарита марина мариэта мария марианна марта мелина милена мухалиса наиля настя наталия
наталья натали налья надежда нелли неля нэля нина нонна нозами нурия олеся ольга оксана пикри
полина равия рада раиля раиса рамиля рания рая рейхан регина резеда рина рита роза розалия
роксана румиля румия рузия рузалия рузиля разиля сабина савбагул серафима сирина сириня
сильва снежана софия софья стелла светлана тамара тамила татьяна талина уляна ульзана фания
фая фиюза флюра фруза фатима фидалия фируза хадиджа шахмаза шамиля энже эвелина эльмира
эльвира эльнура эля элеонора эмилия эрна эсмира юлия юля янина яна ягзуль эльза элина залина
`

const MALE_NAMES_RAW = `
александр алексей анатолий андрей артем артём арсений аждар азат вадим василий виктор виталий
владимир геннадий даниил данис давид денис дмитрий евгений эдуард ильгиз ильдус ильнур ильсур
ильшат игорь леонид линар максим марат михаил николай олег павел петр пётр равиль рамиль
расуль ринат роман руслан рустам рафаэль сергей тимур ярослав юрий
`

const AMBIGUOUS_NAMES_RAW = `
саша женя валя миша слава лёня шура карма
`

function normalizeNameKey(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е")
}

const FEMALE_NAMES = new Set(FEMALE_NAMES_RAW.split(/\s+/).filter(Boolean).map(normalizeNameKey))
const MALE_NAMES = new Set(MALE_NAMES_RAW.split(/\s+/).filter(Boolean).map(normalizeNameKey))
const AMBIGUOUS_NAMES = new Set(AMBIGUOUS_NAMES_RAW.split(/\s+/).filter(Boolean).map(normalizeNameKey))

export type Gender = "M" | "F" | null

export function detectGender(firstName: string): { gender: Gender; confident: boolean } {
  if (!firstName) return { gender: null, confident: false }
  const n = normalizeNameKey(firstName)
  if (!n || n === "неизвестно") return { gender: null, confident: false }
  if (/[\d+]/.test(n)) return { gender: null, confident: false }
  if (FEMALE_NAMES.has(n)) return { gender: "F", confident: true }
  if (MALE_NAMES.has(n)) return { gender: "M", confident: true }
  if (AMBIGUOUS_NAMES.has(n)) {
    return { gender: n.endsWith("а") || n.endsWith("я") ? "F" : "M", confident: false }
  }
  if (n.endsWith("а") || n.endsWith("я")) return { gender: "F", confident: false }
  return { gender: "M", confident: false }
}

const FEMALE_ENDINGS = ["ова", "ева", "ёва", "ина", "ына", "ская", "цкая"]
const MALE_ENDINGS = ["ов", "ев", "ёв", "ин", "ын", "ский", "цкий"]
const NON_DECLINABLE_ENDINGS = [
  "енко", "ко", "ук", "юк", "ян", "швили", "дзе", "уа", "иа",
  "ых", "их", "аги", "оглы",
]

function endsWithAny(s: string, list: string[]): string | null {
  for (const e of list) if (s.endsWith(e)) return e
  return null
}

export function surnameGender(surname: string): Gender {
  if (!surname) return null
  const s = surname.toLowerCase()
  if (endsWithAny(s, NON_DECLINABLE_ENDINGS)) return null
  if (endsWithAny(s, FEMALE_ENDINGS)) return "F"
  if (endsWithAny(s, MALE_ENDINGS)) return "M"
  if (s.endsWith("ая")) return "F"
  if (s.endsWith("ой") || s.endsWith("ый") || s.endsWith("ий")) return "M"
  return null
}

export function feminize(surname: string): string | null {
  const s = surname
  const sl = s.toLowerCase()
  if (endsWithAny(sl, NON_DECLINABLE_ENDINGS)) return null
  if (endsWithAny(sl, FEMALE_ENDINGS) || sl.endsWith("ская") || sl.endsWith("цкая") || sl.endsWith("ая")) {
    return s
  }
  if (sl.endsWith("ов") || sl.endsWith("ев") || sl.endsWith("ёв") || sl.endsWith("ин") || sl.endsWith("ын")) {
    return s + "а"
  }
  if (sl.endsWith("ский") || sl.endsWith("цкий") || sl.endsWith("ской")) {
    return s.slice(0, -2) + "ая"
  }
  if (sl.endsWith("ой") || sl.endsWith("ый") || sl.endsWith("ий")) {
    return s.slice(0, -2) + "ая"
  }
  return null
}

export function masculinize(surname: string): string | null {
  const s = surname
  const sl = s.toLowerCase()
  if (endsWithAny(sl, NON_DECLINABLE_ENDINGS)) return null
  if (endsWithAny(sl, MALE_ENDINGS) || sl.endsWith("ой") || sl.endsWith("ый") || sl.endsWith("ий")) {
    return s
  }
  if (sl.endsWith("ова") || sl.endsWith("ева") || sl.endsWith("ёва") || sl.endsWith("ина") || sl.endsWith("ына")) {
    return s.slice(0, -1)
  }
  if (sl.endsWith("ская")) return s.slice(0, -2) + "ий"
  if (sl.endsWith("цкая")) return s.slice(0, -2) + "ий"
  return null
}

export function alignSurname(
  childSurname: string,
  parentGender: Gender,
): { surname: string; ok: boolean } {
  if (!childSurname) return { surname: childSurname, ok: true }
  if (parentGender === null) return { surname: childSurname, ok: false }
  const current = surnameGender(childSurname)
  if (current === null) return { surname: childSurname, ok: true }
  if (current === parentGender) return { surname: childSurname, ok: true }
  const transformed = parentGender === "F" ? feminize(childSurname) : masculinize(childSurname)
  if (transformed === null) return { surname: childSurname, ok: false }
  return { surname: transformed, ok: true }
}

export function firstWord(s: string | null | undefined): string {
  if (!s) return ""
  const parts = String(s).trim().split(/\s+/)
  return parts[0] || ""
}

export function parentFullName(
  childFio: string | null | undefined,
  contactPerson: string | null | undefined,
): { full: string; needsReview: boolean; changed: boolean } {
  const baseSurname = firstWord(childFio)
  const parentName = firstWord(contactPerson)
  if (!baseSurname && !parentName) return { full: "", needsReview: true, changed: false }
  const { gender, confident } = detectGender(parentName)
  const { surname: aligned, ok } = alignSurname(baseSurname, gender)
  const changed = aligned !== baseSurname
  let needsReview = false
  if (gender === null) needsReview = true
  else if (!ok) needsReview = true
  else if (changed && !confident) needsReview = true
  const full = `${aligned} ${parentName}`.trim()
  return { full, needsReview, changed }
}
