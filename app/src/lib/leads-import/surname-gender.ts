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
таисия есения мирослава злата агата агния пелагея василина юлиана каролина эмма майя стефания
ульяна дарина аглая аврора амалия марьям лия мия ника
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
иван федор егор никита илья кирилл антон константин станислав владислав богдан глеб семен
степан тимофей матвей лев марк макар артур филипп георгий григорий валерий вячеслав борис
аркадий захар родион савва платон ефим елисей гордей демьян назар прохор тарас эмиль дамир
айдар ильяс камиль наиль нияз рашид тагир фарид шамиль эльдар юсуф святослав ростислав вениамин
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

// ─── Разбор «Контактного лица» ───
// В разных базах 1С в колонке лежит то имя («Мария»), то имя с отчеством
// («Мария Петровна»), то полное ФИО («Иванова Мария Петровна», «Мария Иванова»).
// Классифицируем каждое слово и по составу решаем: склеивать с фамилией ребёнка
// или брать ячейку целиком.

// Слова-отношения — не часть ФИО («мама Оля»). Отбрасываются до разбора, но
// только в нижнем регистре: «Дед», «Брат» с заглавной могут быть фамилиями.
const RELATION_WORDS = new Set(
  [
    "мама", "папа", "мать", "отец", "бабушка", "дедушка", "баба", "дед",
    "тетя", "дядя", "опекун", "сестра", "брат",
  ].map(normalizeNameKey),
)

// Частые отчества, не покрываемые суффиксами -ович/-евич (только мужские).
const PATRONYMIC_EXCEPTIONS = new Set(
  ["ильич", "кузьмич", "лукич", "фомич", "никитич", "саввич"].map(normalizeNameKey),
)

// Маркеры тюркских отчеств, пишущихся отдельным словом («Мамед оглы»).
// Голый маркер — не фамилия, хотя «оглы» есть в NON_DECLINABLE_ENDINGS.
const PATRONYMIC_MARKERS = new Set(
  ["оглы", "оглу", "угли", "кызы", "гызы", "улы", "уулу"].map(normalizeNameKey),
)

export function isPatronymic(word: string): boolean {
  const n = normalizeNameKey(word)
  const last = n.split(" ").pop() ?? n
  if (PATRONYMIC_EXCEPTIONS.has(n)) return true
  if (PATRONYMIC_MARKERS.has(last)) return true
  return /(овна|евна|ична|инична)$/.test(n) || /(ович|евич)$/.test(n)
}

// Пол, на который указывает форма отчества. Женских отчеств на -ович/-евич не
// существует — это позволяет отличать отчество от фамилии (Мицкевич, Абрамович).
function patronymicGender(word: string): Gender {
  const n = normalizeNameKey(word)
  const last = n.split(" ").pop() ?? n
  if (/(овна|евна|ична|инична)$/.test(n)) return "F"
  if (last === "кызы" || last === "гызы") return "F"
  if (PATRONYMIC_EXCEPTIONS.has(n)) return "M"
  if (/(ович|евич)$/.test(n)) return "M"
  if (PATRONYMIC_MARKERS.has(last)) return "M"
  return null
}

function isInitials(word: string): boolean {
  return /^[А-ЯЁA-Z]\.([А-ЯЁA-Z]\.?)?$/.test(word.trim())
}

function isSurnameLike(word: string): boolean {
  const n = normalizeNameKey(word)
  if (n.length < 3) return false
  return surnameGender(n) !== null || endsWithAny(n, NON_DECLINABLE_ENDINGS) !== null
}

type TokenKind = "name" | "patronymic" | "initials" | "surname" | "unknown"

// Словарь имён проверяется первым: «Полина», «Марина», «Ирина» иначе ложно
// распознаются как фамилии по окончанию «-ина».
function classifyToken(word: string): TokenKind {
  const n = normalizeNameKey(word)
  if (FEMALE_NAMES.has(n) || MALE_NAMES.has(n) || AMBIGUOUS_NAMES.has(n)) return "name"
  if (isPatronymic(word)) return "patronymic"
  if (isInitials(word)) return "initials"
  if (isSurnameLike(word)) return "surname"
  return "unknown"
}

export interface ParentNameResult {
  full: string
  needsReview: boolean
  changed: boolean
  // ФИО родителя взято из «Контактного лица» целиком (в ячейке было полное ФИО).
  fromContact: boolean
}

// Классический путь: в контакте — имя (± отчество); фамилия берётся у ребёнка
// и согласуется с полом родителя. Пол определяется по имени; если имя вне
// словаря, но есть отчество — по форме отчества (genderHint).
function combineWithChildSurname(
  baseSurname: string,
  nameTokens: string[],
  genderHint?: { gender: Gender; confident: boolean },
): ParentNameResult {
  const parentName = nameTokens[0] ?? ""
  let g = detectGender(parentName)
  if (!g.confident && genderHint?.gender) g = genderHint
  const { surname: aligned, ok } = alignSurname(baseSurname, g.gender)
  const changed = aligned !== baseSurname
  let needsReview = false
  if (g.gender === null) needsReview = true
  else if (!ok) needsReview = true
  else if (changed && !g.confident) needsReview = true
  // Одинокое слово с фамильным окончанием или в форме отчества, отсутствующее
  // в словаре имён, — скорее всего не имя («Контактное лицо: Смирнова» /
  // «Петровна»). Раньше такие строки могли пройти без пометки.
  if (
    parentName &&
    classifyToken(parentName) !== "name" &&
    (isSurnameLike(parentName) || (nameTokens.length === 1 && isPatronymic(parentName)))
  ) {
    needsReview = true
  }
  // Без фамилии ребёнка полноценное ФИО не собрать — на ручную проверку.
  if (!baseSurname) needsReview = true
  const full = [aligned, ...nameTokens].filter(Boolean).join(" ").trim()
  return { full, needsReview, changed, fromContact: false }
}

// «Мамед оглы» → один токен-отчество (маркер приклеивается к предыдущему слову).
function mergePatronymicMarkers(tokens: string[]): string[] {
  const merged: string[] = []
  for (const t of tokens) {
    if (merged.length > 0 && PATRONYMIC_MARKERS.has(normalizeNameKey(t))) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${t}`
    } else {
      merged.push(t)
    }
  }
  return merged
}

export function parentFullName(
  childFio: string | null | undefined,
  contactPerson: string | null | undefined,
): ParentNameResult {
  const baseSurname = firstWord(childFio)
  const tokens = mergePatronymicMarkers(
    String(contactPerson ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      // Слово-отношение отбрасывается только в нижнем регистре: «Дед»,
      // «Брат» с заглавной вполне могут быть фамилиями.
      .filter((t) => !(RELATION_WORDS.has(normalizeNameKey(t)) && /^[а-яё]/.test(t))),
  )

  if (!baseSurname && tokens.length === 0) {
    return { full: "", needsReview: true, changed: false, fromContact: false }
  }
  if (tokens.length <= 1) return combineWithChildSurname(baseSurname, tokens)

  const kinds = tokens.map(classifyToken)

  // Гендерная развязка отчество/фамилия: женских отчеств на -ович/-евич не
  // существует, поэтому «Ольга Мицкевич» — это фамилия, а не отчество.
  // Обратное несоответствие (мужское имя + женская форма) — в unknown.
  if (kinds[0] === "name") {
    const g = detectGender(tokens[0])
    if (g.confident) {
      for (let i = 1; i < kinds.length; i++) {
        if (kinds[i] !== "patronymic") continue
        const pg = patronymicGender(tokens[i])
        if (pg !== null && pg !== g.gender) {
          kinds[i] = pg === "M" ? "surname" : "unknown"
        }
      }
    }
  }

  // «Имя Отчество» — фамилии в ячейке нет: фамилия ребёнка + вся ячейка
  // (отчество сохраняется и на этапе 2 попадёт в поле «Отчество» клиента).
  // Имя вне словаря («Ратмир Петрович») тоже сюда: пол берём из отчества.
  if ((kinds[0] === "name" || kinds[0] === "unknown") && kinds.slice(1).every((k) => k === "patronymic")) {
    const pg = patronymicGender(tokens[tokens.length - 1])
    return combineWithChildSurname(
      baseSurname,
      tokens,
      pg ? { gender: pg, confident: true } : undefined,
    )
  }

  // В ячейке полное ФИО — берём его целиком, фамилию ребёнка не трогаем.
  // Если фамилия распознана не первым словом («Мария Иванова», «Ольга Ивановна
  // Смирнова») — переставляем её вперёд: на этапе 2 первое слово промежуточного
  // файла становится фамилией клиента.
  let ordered = tokens
  let firstKind = kinds[0]
  if (kinds[0] === "name") {
    let idx = kinds.lastIndexOf("surname")
    if (idx < 0) idx = kinds.lastIndexOf("unknown")
    if (idx > 0) {
      ordered = [tokens[idx], ...tokens.slice(0, idx), ...tokens.slice(idx + 1)]
      firstKind = kinds[idx]
    }
  }
  // Вычитка не нужна, только если картина однозначна: распознано имя, первым
  // словом стоит ровно одна фамилия, и нет инициалов/нераспознанных слов.
  const confidentFio =
    kinds.includes("name") &&
    firstKind === "surname" &&
    kinds.filter((k) => k === "surname").length === 1 &&
    !kinds.includes("unknown") &&
    !kinds.includes("initials")
  return {
    full: ordered.join(" "),
    needsReview: !confidentFio,
    changed: false,
    fromContact: true,
  }
}

// Совместимость отчества с полом имени: «Иванова Ольга Мицкевич» не должна
// получить «Мицкевич» в поле «Отчество».
function patronymicFitsName(name: string, patr: string): boolean {
  const g = detectGender(name)
  if (!g.confident || g.gender === null) return true
  const pg = patronymicGender(patr)
  return pg === null || pg === g.gender
}

// «Фамилия Имя [Отчество]» из промежуточного файла → поля клиента.
// Отчество распознаётся по суффиксу; иначе всё после фамилии — имя (как раньше).
export function splitParentFio(parent: string): {
  firstName: string
  lastName: string
  patronymic: string | null
} {
  const parts = parent.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: "", lastName: "", patronymic: null }
  if (parts.length === 1) return { firstName: parts[0], lastName: "", patronymic: null }
  const last = parts[parts.length - 1]
  // Ручная правка в естественном порядке «Имя Отчество Фамилия»: первое слово —
  // словарное имя, второе — совместимое с ним отчество, тогда фамилия — третье
  // (даже если она сама похожа на отчество: «Ольга Ивановна Мицкевич»).
  if (
    parts.length === 3 &&
    isPatronymic(parts[1]) &&
    classifyToken(parts[0]) === "name" &&
    patronymicFitsName(parts[0], parts[1])
  ) {
    return { lastName: last, firstName: parts[0], patronymic: parts[1] }
  }
  // Тюркское отчество из двух слов: «Мамедов Руслан Мамед оглы».
  if (parts.length >= 4 && PATRONYMIC_MARKERS.has(normalizeNameKey(last))) {
    const patr = `${parts[parts.length - 2]} ${last}`
    return { lastName: parts[0], firstName: parts.slice(1, -2).join(" "), patronymic: patr }
  }
  if (
    parts.length >= 3 &&
    isPatronymic(last) &&
    !PATRONYMIC_MARKERS.has(normalizeNameKey(last)) &&
    patronymicFitsName(parts[1], last)
  ) {
    return { lastName: parts[0], firstName: parts.slice(1, -1).join(" "), patronymic: last }
  }
  return { firstName: parts.slice(1).join(" "), lastName: parts[0], patronymic: null }
}
