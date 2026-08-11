/** United States–only location gate for scraped jobs. */

const US_ALIASES =
  /\b(?:united\s+states(?:\s+of\s+america)?|u\.?\s*s\.?a?\.?|usa)\b/i;

const US_STATE_NAMES =
  /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|texas|utah|vermont|virginia|washington|west\s+virginia|wisconsin|wyoming|district\s+of\s+columbia|puerto\s+rico)\b/i;

/** ", CA" / " NY" style — word-boundary state codes (not "IN" alone in prose). */
const US_STATE_CODE =
  /,\s*(?:A[LKZR]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEHINOST]|N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/;

const NON_US_COUNTRY =
  /\b(?:canada|mexico|united\s+kingdom|uk|u\.?k\.?|great\s+britain|gb|england|scotland|wales|ireland|germany|france|spain|italy|netherlands|holland|belgium|switzerland|sweden|norway|denmark|finland|poland|portugal|austria|australia|new\s+zealand|india|singapore|japan|china|hong\s+kong|south\s+korea|korea|taiwan|philippines|indonesia|vietnam|thailand|malaysia|brazil|argentina|chile|colombia|israel|uae|united\s+arab\s+emirates|saudi\s+arabia|south\s+africa|nigeria|kenya|egypt|turkey|pakistan|bangladesh|sri\s+lanka|russia|ukraine|romania|czech|hungary|greece|emirates)\b/i;

/** ", UK" / ", U.K." / ", GB" / ", EU" suffix — do NOT include CA/IN (US state codes). */
const NON_US_COUNTRY_SUFFIX =
  /,\s*(?:UK|U\.K\.|GB|G\.B\.|EU|AU|NZ|SG|DE|FR|NL|IE|ES|IT)\b/i;

/** Major non-US cities that often appear without a country name. */
const NON_US_CITY =
  /\b(?:amsterdam|rotterdam|utrecht|the\s+hague|eindhoven|london|manchester|cambridge|oxford|edinburgh|bristol|birmingham|berlin|munich|frankfurt|paris|lyon|dublin|cork|toronto|vancouver|montreal|ottawa|sydney|melbourne|singapore|tokyo|osaka|seoul|shanghai|beijing|bangalore|bengaluru|hyderabad|mumbai|delhi|zurich|geneva|stockholm|copenhagen|oslo|helsinki|warsaw|prague|vienna|lisbon|madrid|barcelona|milan|rome|sao\s+paulo|mexico\s+city|tel\s+aviv|dubai)\b/i;

const NON_US_REGION =
  /\b(?:emea|apac|latam|europe|asia|africa|middle\s+east|eu\s+only|outside\s+(?:the\s+)?(?:us|u\.?s\.?a?\.?|united\s+states)|ing\s+nl|netherlands)\b/i;

const CANADIAN_HINT =
  /\b(?:toronto|vancouver|montreal|ottawa|calgary|edmonton|ontario|quebec|british\s+columbia|alberta|manitoba|saskatchewan|nova\s+scotia|new\s+brunswick)\b.*\b(?:canada|on|bc|qc|ab)\b|\b(?:canada)\b/i;

/** Must be enrolled at a foreign university / EU passport path — blocks CSULB F-1 candidate. */
const FOREIGN_ENROLLMENT_REQUIRED =
  /\b(?:enrolled\s+at\s+(?:a\s+)?(?:dutch|eu|european|netherlands|german|french|uk|british)\s+university|dutch\s+university|eu[- ]university|eu\s+passport\s+holders?|must\s+be\s+enrolled\s+at\s+(?:a\s+)?(?:dutch|eu)|internship(?:'s)?\s+duration.{0,80}dutch\s+university)\b/i;

const VAGUE_OK =
  /^(?:remote|hybrid|onsite|on-site|multiple\s+locations|various\s+locations|nationwide)?$/i;

/**
 * Returns true when the job looks US-based (or location is empty / vague Remote
 * after a US-scoped search). Rejects clear non-US countries, cities, and regions.
 */
export function isUsJobLocation(location?: string | null, description?: string): boolean {
  const loc = (location || '').trim();
  const desc = (description || '').slice(0, 6000);
  const hay = `${loc}\n${desc}`;

  if (FOREIGN_ENROLLMENT_REQUIRED.test(hay)) return false;

  const locHasUsSignal =
    US_ALIASES.test(loc) || US_STATE_NAMES.test(loc) || US_STATE_CODE.test(loc);

  // Clear non-US country/region on the location string
  if (NON_US_REGION.test(loc) || NON_US_COUNTRY.test(loc) || NON_US_COUNTRY_SUFFIX.test(loc)) {
    // "Remote Canada" etc. — reject even if somehow mixed
    if (!locHasUsSignal) return false;
    // Mixed "Toronto, Canada / NYC, USA" — still reject if Canada/UK explicitly on loc without US outweighing
    if (/\b(?:canada|united\s+kingdom|uk|india|germany|australia)\b/i.test(loc) && !US_ALIASES.test(loc)) {
      return false;
    }
  }

  // Ambiguous shared city names (Cambridge, London, …) — only reject without US signal
  if (NON_US_CITY.test(loc) && !locHasUsSignal) return false;
  if (CANADIAN_HINT.test(loc) && !locHasUsSignal) return false;

  // Strong non-US office / based-in requirement in the JD
  if (
    /\b(?:based\s+in|located\s+in|location\s*:|office\s+in|must\s+be\s+(?:based|located)\s+in)\s*[^.&\n]{0,60}\b(?:amsterdam|netherlands|holland|canada|india|uk|united\s+kingdom|germany|singapore|ireland|australia|mexico|brazil|london|berlin|paris|dublin)\b/i.test(
      desc
    )
  ) {
    return false;
  }

  if (!loc || VAGUE_OK.test(loc)) {
    // Empty / Remote — still reject clear abroad-only JDs
    if (FOREIGN_ENROLLMENT_REQUIRED.test(desc)) return false;
    if (NON_US_CITY.test(desc) && !US_ALIASES.test(desc) && !US_STATE_NAMES.test(desc)) {
      // e.g. Remote + "Location: Amsterdam" in body without any US signal
      if (
        /\b(?:location|based\s+in|office)\s*:?\s*[^\n]{0,40}\b(?:amsterdam|netherlands|london|berlin|paris|dublin|toronto|singapore)\b/i.test(
          desc
        )
      ) {
        return false;
      }
    }
    if (NON_US_COUNTRY.test(hay) && !US_ALIASES.test(hay) && !US_STATE_NAMES.test(hay)) {
      if (
        /\b(?:india|canada|uk|united\s+kingdom|germany|singapore|netherlands|holland)\s+only\b/i.test(
          desc
        ) ||
        /\bmust\s+be\s+(?:based|located|enrolled).{0,40}\b(?:netherlands|holland|india|canada|uk|germany)\b/i.test(
          desc
        )
      ) {
        return false;
      }
    }
    return true;
  }

  if (locHasUsSignal) return true;

  if (/^remote\b/i.test(loc) && !NON_US_COUNTRY.test(loc) && !NON_US_CITY.test(loc)) {
    // Remote + JD clearly Amsterdam/Dutch enrollment → reject
    if (FOREIGN_ENROLLMENT_REQUIRED.test(desc)) return false;
    if (
      /\blocation\s*:?\s*amsterdam\b/i.test(desc) ||
      /\bbased\s+in\s+amsterdam\b/i.test(desc)
    ) {
      return false;
    }
    return true;
  }

  // Remote – North America (US-eligible); Canada-only still rejected via NON_US / CANADIAN_HINT
  if (
    /\bremote\b[\s\S]{0,40}\bnorth\s+america\b|\bnorth\s+america\b[\s\S]{0,40}\bremote\b/i.test(loc) ||
    /\bremote\b[\s\S]{0,40}\bnorth\s+america\b|\bnorth\s+america\b[\s\S]{0,40}\bremote\b/i.test(hay)
  ) {
    if (/\bcanada\s+only\b|\bonly\s+canada\b/i.test(hay)) return false;
    return true;
  }

  if (NON_US_COUNTRY.test(loc) || NON_US_CITY.test(loc)) return false;

  return true;
}
