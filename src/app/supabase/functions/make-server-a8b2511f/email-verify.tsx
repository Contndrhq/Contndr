// ══════════════════════════════════════════════════════════════════════════
// Contndr DIY Email Verification & Pattern Engine
// Zero external API dependencies — uses free DNS-over-HTTPS for MX lookups
// ══════════════════════════════════════════════════════════════════════════

// ── Verification result type ──
export interface EmailVerification {
  status: "valid" | "risky" | "invalid" | "unknown" | "pattern_guessed";
  score: number; // 0-100 confidence score
  flags: string[]; // e.g. ["mx_valid", "disposable", "role_based"]
  mx_valid: boolean;
  is_disposable: boolean;
  is_role_based: boolean;
  is_free_provider: boolean;
  is_catch_all: boolean | null; // null = couldn't determine
  domain: string;
  suggestion?: string; // Typo correction suggestion
}

// ── MX Record Cache (in-memory per invocation) ──
const mxCache = new Map<string, { valid: boolean; records: string[]; ts: number }>();
const MX_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── DNS-over-HTTPS MX Lookup (Google Public DNS — free, no API key) ──
export async function checkMxRecords(domain: string): Promise<{ valid: boolean; records: string[] }> {
  // Check cache first
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.ts < MX_CACHE_TTL) {
    return { valid: cached.valid, records: cached.records };
  }

  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { valid: false, records: [] };
    const data = await res.json();
    
    // Status 0 = NOERROR, Answer contains MX records
    const records = (data.Answer || [])
      .filter((a: any) => a.type === 15) // MX record type
      .map((a: any) => a.data || "")
      .filter(Boolean);
    
    const valid = records.length > 0;
    mxCache.set(domain, { valid, records, ts: Date.now() });
    return { valid, records };
  } catch {
    // DNS lookup failed — don't cache failures, mark unknown
    return { valid: false, records: [] };
  }
}

// ── Syntax Validation (RFC 5322 simplified) ──
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function isValidSyntax(email: string): boolean {
  if (!email || email.length > 254) return false;
  if (!EMAIL_REGEX.test(email)) return false;
  const [local, domain] = email.split("@");
  if (!local || local.length > 64) return false;
  if (!domain || !domain.includes(".")) return false;
  // TLD must be at least 2 chars
  const tld = domain.split(".").pop() || "";
  if (tld.length < 2) return false;
  return true;
}

// ── Disposable Email Domains (comprehensive list) ──
const DISPOSABLE_DOMAINS = new Set([
  // Top disposable services
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "guerrillamail.net",
  "guerrillamail.org", "guerrillamail.de", "grr.la", "guerrillamailblock.com",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "throwaway.email",
  "throwaway.com", "yopmail.com", "yopmail.fr", "yopmail.net",
  "sharklasers.com", "guerrillamail.biz", "trashmail.com", "trashmail.net",
  "trashmail.org", "trashmail.me", "trashmail.io", "trashymail.com",
  "mailnesia.com", "maildrop.cc", "dispostable.com", "getnada.com",
  "nada.email", "tempail.com", "emailondeck.com", "24hourmail.com",
  "fakeinbox.com", "fakemail.net", "emailfake.com", "generator.email",
  "inboxbear.com", "mailcatch.com", "mailexpire.com", "maileater.com",
  "mailforspam.com", "mailhazard.com", "mailhazard.us", "mailimate.com",
  "mailnator.com", "mailnull.com", "mailscrap.com", "mailshell.com",
  "mailsiphon.com", "mailtemp.info", "mailzilla.com", "mailzilla.org",
  "mintemail.com", "moakt.com", "mohmal.com", "mt2015.com",
  "mx0.wwwnew.eu", "mytemp.email", "mytrashmail.com", "nobulk.com",
  "nospamfor.us", "nowmymail.com", "objectmail.com", "obobbo.com",
  "oneoffmail.com", "owlpic.com", "pjjkp.com", "plexolan.de",
  "pookmail.com", "proxymail.eu", "rcpt.at", "reallymymail.com",
  "recode.me", "recursor.net", "regbypass.com", "rhyta.com",
  "rklips.com", "rmqkr.net", "royal.net", "rtrtr.com",
  "s0ny.net", "safersignup.de", "safetymail.info", "safetypost.de",
  "sandelf.de", "saynotospams.com", "scatmail.com", "schafmail.de",
  "selfdestructingmail.com", "sendspamhere.com", "shiftmail.com",
  "skeefmail.com", "slaskpost.se", "slipry.net", "slopsbox.com",
  "smashmail.de", "soodonims.com", "spam4.me", "spamavert.com",
  "spambob.com", "spambob.net", "spambob.org", "spambog.com",
  "spambog.de", "spambog.ru", "spambox.us", "spamcannon.com",
  "spamcannon.net", "spamcero.com", "spamcon.org", "spamcorptastic.com",
  "spamcowboy.com", "spamcowboy.net", "spamcowboy.org", "spamday.com",
  "spamex.com", "spamfighter.cf", "spamfighter.ga", "spamfighter.gq",
  "spamfighter.ml", "spamfighter.tk", "spamfree24.com", "spamfree24.de",
  "spamfree24.eu", "spamfree24.info", "spamfree24.net", "spamfree24.org",
  "spamgoes.in", "spamherelots.com", "spamhereplease.com",
  "spamhole.com", "spamify.com", "spaminator.de", "spamkill.info",
  "spaml.com", "spaml.de", "spammotel.com", "spamobox.com",
  "spamoff.de", "spamslicer.com", "spamspot.com", "spamstack.net",
  "spamthis.co.uk", "spamthisplease.com", "spamtrap.ro",
  "spamtrail.com", "spamwc.de", "10minutemail.com", "10minutemail.net",
  "10minutemail.org", "20minutemail.com", "20minutemail.it",
  "tempinbox.com", "tempomail.fr", "temporaryemail.net",
  "temporaryemail.us", "temporaryforwarding.com", "temporaryinbox.com",
  "temporarymailaddress.com", "thankdog.net", "thatim.info",
  "thisisnotmyrealemail.com", "throwawayemailaddress.com",
  "tmail.ws", "tmailinator.com", "tokenmail.de", "toomail.biz",
  "tradermail.info", "trash-amil.com", "trash-mail.at", "trash-mail.com",
  "trash-mail.de", "trash2009.com", "trash2010.com", "trash2011.com",
  "trashdevil.com", "trashdevil.de", "trashemail.de", "trashmail.at",
  "trashmail.de", "trashmail.ws", "trashmailer.com", "trashymail.net",
  "bugmenot.com", "binkmail.com", "bobmail.info", "bofthew.com",
  "boun.cr", "bouncr.com", "burnthis.com", "bspamfree.org",
  "buffemail.com", "cachedot.net", "centermail.com", "centermail.net",
  "chammy.info", "cheatmail.de", "chogmail.com", "choicemail1.com",
  "clixser.com", "cmail.club", "cmail.com", "cmail.net", "cmail.org",
  "coldemail.info", "consumerriot.com", "cool.fr.nf", "correo.blogos.net",
  "cosmorph.com", "courriel.fr.nf", "crapmail.org", "crazymailing.com",
  "cubiclink.com", "curryworld.de", "cust.in", "cuvox.de",
  "dacoolest.com", "dandikmail.com", "dayrep.com", "dbunker.com",
  "dcemail.com", "deadaddress.com", "deadfake.cf", "deadfake.ga",
  "deadfake.ml", "deadfake.tk", "deadspam.com", "deagot.com",
  "dealja.com", "despam.it", "despammed.com", "devnullmail.com",
  "dfgh.net", "digitalsanctuary.com", "dingbone.com", "dingfone.com",
  "discard.cf", "discard.email", "discard.ga", "discard.gq",
  "discard.ml", "discard.tk", "discardmail.com", "discardmail.de",
  "disposableaddress.com", "disposableemailaddresses.emailmiser.com",
  "disposableinbox.com", "dispose.it", "disposeamail.com",
  "disposemail.com", "dispomail.eu", "dm.w3internet.co.uk",
  "dodgeit.com", "dodgemail.de", "dodgit.com", "dodgit.org",
  "dontreg.com", "dontsendmespam.de", "dotmsg.com", "drdrb.com",
  "drdrb.net", "dropmail.me", "dumpandjunk.com", "dumpmail.de",
  "dumpyemail.com", "duskmail.com", "e4ward.com", "easytrashmail.com",
  "einrot.com", "email60.com", "emailgo.de", "emailias.com",
  "emailigo.de", "emailinfive.com", "emaillime.com", "emailmiser.com",
  "emailproxsy.com", "emails.ga", "emailsensei.com", "emailspam.cf",
  "emailspam.ga", "emailspam.gq", "emailspam.ml", "emailspam.tk",
  "emailtemporario.com.br", "emailthe.net", "emailtmp.com",
  "emailto.de", "emailwarden.com", "emailx.at.hm", "emailxfer.com",
  "emz.net", "enterto.com", "ephemail.net", "etranquil.com",
  "etranquil.net", "etranquil.org", "evopo.com", "explodemail.com",
  "express.net.ua", "eyepaste.com", "fastacura.com", "fastchevy.com",
  "fastchrysler.com", "fastkawasaki.com", "fastmazda.com",
  "fastmitsubishi.com", "fastnissan.com", "fastsubaru.com",
  "fastsuzuki.com", "fasttoyota.com", "fastyamaha.com",
  "filzmail.com", "fixmail.tk", "fizmail.com", "fleckens.hu",
  "flyspam.com", "fr33mail.info", "frapmail.com", "freemail.ms",
  "freemails.cf", "freemails.ga", "freemails.ml",
  "freundin.ru", "friendlymail.co.uk", "front14.org",
  "fuckingduh.com", "fudgerub.com", "fux0ringduh.com",
  "garliclife.com", "get1mail.com", "get2mail.fr", "getairmail.com",
  "getmails.eu", "getonemail.com", "getonemail.net",
  "ghosttexter.de", "girlsundertheinfluence.com", "gishpuppy.com",
  "goemailgo.com", "gorillaswithdirtyarmpits.com",
  "gotmail.com", "gotmail.net", "gotmail.org", "gotti.otherinbox.com",
  "great-host.in", "greensloth.com", "gsrv.co.uk", "guerillamail.biz",
  "guerillamail.com", "guerillamail.de", "guerillamail.info",
  "guerillamail.net", "guerillamail.org", "gustr.com",
  "h8s.org", "hacccc.com", "haltospam.com", "harakirimail.com",
  "hartbot.de", "hatespam.org", "herp.in", "hidemail.de",
  "hidzz.com", "hmamail.com", "hopemail.biz", "hotpop.com",
  "hulapla.de", "ieatspam.eu", "ieatspam.info", "ieh-mail.de",
  "ihateyoualot.info", "iheartspam.org", "imails.info",
  "inboxalias.com", "inboxclean.com", "inboxclean.org",
  "inboxed.im", "inboxed.pw", "incognitomail.com",
  "incognitomail.net", "incognitomail.org", "insorg.org",
  "ipoo.org", "irish2me.com", "iwi.net", "jetable.com",
  "jetable.fr.nf", "jetable.net", "jetable.org", "jnxjn.com",
  "jourrapide.com", "junk1e.com", "junkmail.com", "junkmail.ga",
  "junkmail.gq", "kasmail.com", "kaspop.com", "keepmymail.com",
  "killmail.com", "killmail.net", "kimsdisk.com", "kingsq.ga",
  "kiois.com", "klassmaster.com", "klassmaster.net", "klzlk.com",
  "koszmail.pl", "kurzepost.de", "lawlita.com", "letthemeatspam.com",
  "lhsdv.com", "lifebyfood.com", "link2mail.net", "litedrop.com",
  "loadby.us", "login-email.cf", "login-email.ga", "login-email.ml",
  "login-email.tk", "lol.ovpn.to", "lolfreak.net", "lookugly.com",
  "lortemail.dk", "lr78.com", "lroid.com", "lukop.dk",
  "m21.cc", "mail-filter.com", "mail-temporaire.fr",
  "mail.by", "mail.mezimages.net", "mail.zp.ua", "mail114.net",
  "mail1a.de", "mail21.cc", "mail2rss.org", "mail333.com",
  "mail4trash.com", "mailbidon.com", "mailbiz.biz", "mailblocks.com",
  "mailbucket.org", "mailcat.biz", "mailcatch.com",
  "mailde.de", "mailde.info", "maildx.com", "maileimer.de",
  "mailexpire.com", "mailfa.tk", "mailfree.ga", "mailfree.gq",
  "mailfree.ml", "mailfreeonline.com", "mailfs.com",
  "mailguard.me", "mailhex.com", "mailimate.com",
  "mailin8r.com", "mailinater.com", "mailinator.com",
  "mailinator.net", "mailinator.org", "mailinator.us",
  "mailinator2.com", "mailinblack.com", "mailincubator.com",
  "mailismagic.com", "mailjunk.cf", "mailjunk.ga", "mailjunk.gq",
  "mailjunk.ml", "mailjunk.tk", "mailme.ir", "mailme.lv",
  "mailme24.com", "mailmetrash.com", "mailmoat.com",
  "mailms.com", "mailna.biz", "mailna.co", "mailna.in",
  "mailna.me", "mailnator.com", "mailnesia.com", "mailnull.com",
  "mailorg.org", "mailpick.biz", "mailproxsy.com",
  "mailquack.com", "mailrock.biz", "mailscrap.com",
  "mailshell.com", "mailsiphon.com", "mailslite.com",
  "mailspeed.ru", "mailstache.com", "mailtemp.info",
  "mailtemp.net", "mailtome.de", "mailtothis.com", "mailtrash.net",
  "mailtv.net", "mailtv.tv", "mailzilla.com", "mailzilla.org",
  "mailzilla.orgmbx.cc", "makemetheking.com", "manifestgenerator.com",
  "manybrain.com", "mbx.cc", "mega.zik.dj", "meinspamschutz.de",
  "meltmail.com", "messagebeamer.de", "mezimages.net",
  "mfsa.ru", "mierdamail.com", "migmail.pl", "migumail.com",
  "mindless.com", "ministry-of-silly-walks.de",
  "mintemail.com", "misterpinball.de", "mjukgansen.com",
  "mobi.web.id", "mobileninja.co.uk", "mohmal.com",
  "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  "monumentmail.com", "msa.minsmail.com", "mt2009.com",
  "mt2014.com", "mt2015.com", "muchomail.com", "mucinobolar.com",
  "mx0.wwwnew.eu", "my10minutemail.com", "mycard.net.ua",
  "mycleaninbox.net", "myemailboxy.com", "mymail-in.net",
  "mymailoasis.com", "mynetstore.de", "mypacks.net",
  "mypartyclip.de", "myphantom.com", "mysamp.de", "myspaceinc.com",
  "myspaceinc.net", "myspaceinc.org", "myspacepimpedup.com",
  "mytemp.email", "mytempemail.com", "mytempmail.com",
  "mytrashmail.com", "nabala.com", "neomailbox.com",
  "nervmich.net", "nervtansen.de", "netmails.com", "netmails.net",
  "neverbox.com", "no-spam.ws", "nobulk.com", "noclickemail.com",
  "nogmailspam.info", "nomail.ch", "nomail.xl.cx",
  "nomail2me.com", "nomorespamemails.com", "nonspam.eu",
  "nonspammer.de", "noref.in", "nospam.ze.tc", "nospam4.us",
  "nospamfor.us", "nospammail.net", "nospamthanks.info",
  "nothingtoseehere.ca", "nowmymail.com", "nurfuerspam.de",
  "nus.edu.sg", "nwldx.com", "objectmail.com", "obobbo.com",
  "odaymail.com", "oneoffemail.com", "oneoffmail.com",
  "onewaymail.com", "oopi.org", "ordinaryamerican.net",
  "otherinbox.com", "ourklips.com", "outlawspam.com",
  "ovpn.to", "owlpic.com", "pancakemail.com", "pimpedupmyspace.com",
  "pjjkp.com", "plexolan.de", "poczta.onet.pl", "politikerclub.de",
  "pookmail.com", "privacy.net", "privatdemail.net",
  "proxymail.eu", "prtnx.com", "punkass.com", "putthisinyouremail.com",
  "pwrby.com", "qisdo.com", "qisoa.com",
]);

// ── Role-Based Email Prefixes ──
const ROLE_PREFIXES = new Set([
  "info", "admin", "administrator", "support", "sales", "contact",
  "help", "helpdesk", "office", "team", "hr", "humanresources",
  "marketing", "billing", "accounts", "accounting", "finance",
  "legal", "compliance", "noreply", "no-reply", "no.reply",
  "postmaster", "abuse", "webmaster", "hostmaster", "mailer-daemon",
  "security", "newsletter", "news", "press", "media", "pr",
  "service", "customerservice", "customercare", "feedback",
  "orders", "shipping", "returns", "operations", "ops",
  "reception", "frontdesk", "general", "enquiries", "inquiries",
  "careers", "jobs", "recruiting", "recruitment", "talent",
  "hello", "hi", "hey", "mail", "email", "inbox",
  "subscribe", "unsubscribe", "notify", "notifications",
  "alerts", "updates", "system", "automated", "auto",
  "donotreply", "do-not-reply", "do.not.reply",
  "privacy", "gdpr", "dpo", "dataprotection",
  "partners", "partnerships", "vendor", "vendors",
  "procurement", "purchasing", "it", "tech",
  "dev", "developer", "engineering", "api",
]);

// ── Free Email Providers ──
const FREE_PROVIDERS = new Set([
  "gmail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de",
  "yahoo.it", "yahoo.es", "yahoo.ca", "yahoo.com.au", "yahoo.co.in",
  "yahoo.co.jp", "yahoo.com.br", "yahoo.com.mx", "yahoo.co.id",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de",
  "hotmail.it", "hotmail.es", "hotmail.ca",
  "outlook.com", "outlook.fr", "outlook.de", "outlook.es",
  "outlook.co.uk", "outlook.com.au",
  "live.com", "live.co.uk", "live.fr", "live.de",
  "msn.com", "aol.com", "protonmail.com", "protonmail.ch",
  "proton.me", "pm.me",
  "icloud.com", "me.com", "mac.com",
  "mail.com", "email.com", "usa.com",
  "zoho.com", "zohomail.com",
  "yandex.com", "yandex.ru", "yandex.ua",
  "mail.ru", "inbox.ru", "list.ru", "bk.ru",
  "gmx.com", "gmx.de", "gmx.net", "gmx.at", "gmx.ch",
  "web.de", "t-online.de", "freenet.de",
  "laposte.net", "orange.fr", "wanadoo.fr", "sfr.fr", "free.fr",
  "libero.it", "virgilio.it", "alice.it", "tin.it",
  "fastmail.com", "fastmail.fm",
  "tutanota.com", "tuta.io", "tutamail.com",
  "rocketmail.com", "att.net", "sbcglobal.net", "bellsouth.net",
  "cox.net", "earthlink.net", "juno.com", "netzero.com",
  "rediffmail.com", "163.com", "126.com", "qq.com", "sina.com",
  "yeah.net", "foxmail.com",
  "comcast.net", "verizon.net", "charter.net", "spectrum.net",
  "optonline.net", "frontier.com", "windstream.net",
]);

// ── Common Domain Typos (domain -> suggested correction) ──
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmaill.com": "gmail.com", "gmal.com": "gmail.com",
  "gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmaik.com": "gmail.com",
  "gmali.com": "gmail.com", "gmail.co": "gmail.com", "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com", "gmai.com": "gmail.com", "gmailcom": "gmail.com",
  "gmiail.com": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhaoo.com": "yahoo.com",
  "yaoo.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahoo.cm": "yahoo.com",
  "hotmal.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmial.com": "hotmail.com",
  "hotmil.com": "hotmail.com", "hotamil.com": "hotmail.com",
  "outlok.com": "outlook.com", "outloook.com": "outlook.com", "outlookcom": "outlook.com",
  "outllook.com": "outlook.com",
};

// ── Email Pattern Templates (ordered by commonality) ──
export type PatternType = 
  | "first.last" | "first" | "flast" | "firstl" | "first_last"
  | "last.first" | "first-last" | "last" | "firstlast" | "lfirst"
  | "f.last" | "first.l" | "f_last" | "last_first" | "lastfirst";

const PATTERN_TEMPLATES: { pattern: PatternType; weight: number }[] = [
  { pattern: "first.last", weight: 35 },
  { pattern: "first", weight: 15 },
  { pattern: "flast", weight: 12 },
  { pattern: "firstl", weight: 8 },
  { pattern: "first_last", weight: 7 },
  { pattern: "firstlast", weight: 6 },
  { pattern: "last.first", weight: 4 },
  { pattern: "first-last", weight: 4 },
  { pattern: "f.last", weight: 3 },
  { pattern: "first.l", weight: 2 },
  { pattern: "last", weight: 2 },
  { pattern: "f_last", weight: 1 },
  { pattern: "lfirst", weight: 1 },
];

// ── Generate email from pattern + name ──
function applyPattern(pattern: PatternType, first: string, last: string): string {
  const f = first.toLowerCase().replace(/[^a-z]/g, "");
  const l = last.toLowerCase().replace(/[^a-z]/g, "");
  if (!f || !l) return "";
  
  switch (pattern) {
    case "first.last": return `${f}.${l}`;
    case "first": return f;
    case "flast": return `${f[0]}${l}`;
    case "firstl": return `${f}${l[0]}`;
    case "first_last": return `${f}_${l}`;
    case "firstlast": return `${f}${l}`;
    case "last.first": return `${l}.${f}`;
    case "first-last": return `${f}-${l}`;
    case "f.last": return `${f[0]}.${l}`;
    case "first.l": return `${f}.${l[0]}`;
    case "last": return l;
    case "f_last": return `${f[0]}_${l}`;
    case "lfirst": return `${l[0]}${f}`;
    case "last_first": return `${l}_${f}`;
    case "lastfirst": return `${l}${f}`;
    default: return `${f}.${l}`;
  }
}

// ── Detect which email pattern a domain uses ──
// Given known emails from the same domain, figure out the pattern
export function detectDomainPattern(
  knownEmails: { email: string; first_name: string; last_name: string }[]
): PatternType | null {
  if (knownEmails.length === 0) return null;
  
  const patternVotes = new Map<PatternType, number>();
  
  for (const { email, first_name, last_name } of knownEmails) {
    if (!email || !first_name || !last_name) continue;
    const [local] = email.split("@");
    if (!local) continue;
    
    // Try each pattern and see if it matches
    for (const { pattern } of PATTERN_TEMPLATES) {
      const generated = applyPattern(pattern, first_name, last_name);
      if (generated && generated === local.toLowerCase()) {
        patternVotes.set(pattern, (patternVotes.get(pattern) || 0) + 1);
      }
    }
  }
  
  if (patternVotes.size === 0) return null;
  
  // Return the most-voted pattern
  let bestPattern: PatternType | null = null;
  let bestVotes = 0;
  for (const [pattern, votes] of patternVotes) {
    if (votes > bestVotes) {
      bestVotes = votes;
      bestPattern = pattern;
    }
  }
  
  return bestPattern;
}

// ── Generate email candidates for a person at a domain ──
export function generateEmailCandidates(
  firstName: string,
  lastName: string,
  domain: string,
  detectedPattern?: PatternType | null,
): { email: string; pattern: PatternType; confidence: number }[] {
  const candidates: { email: string; pattern: PatternType; confidence: number }[] = [];
  
  for (const { pattern, weight } of PATTERN_TEMPLATES) {
    const local = applyPattern(pattern, firstName, lastName);
    if (!local) continue;
    const email = `${local}@${domain}`;
    
    // If we detected the domain's pattern, boost that one significantly
    let confidence = weight;
    if (detectedPattern && pattern === detectedPattern) {
      confidence = 85; // High confidence for detected pattern
    } else if (detectedPattern) {
      confidence = Math.min(confidence, 5); // Low confidence for non-matching patterns
    }
    
    candidates.push({ email, pattern, confidence });
  }
  
  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

// ── Main Verification Function ──
export async function verifyEmail(email: string): Promise<EmailVerification> {
  const result: EmailVerification = {
    status: "unknown",
    score: 0,
    flags: [],
    mx_valid: false,
    is_disposable: false,
    is_role_based: false,
    is_free_provider: false,
    is_catch_all: null,
    domain: "",
  };
  
  // 1. Syntax check
  if (!isValidSyntax(email)) {
    result.status = "invalid";
    result.score = 0;
    result.flags.push("invalid_syntax");
    return result;
  }
  
  const [local, domain] = email.toLowerCase().split("@");
  result.domain = domain;
  
  // 2. Check for typos
  if (DOMAIN_TYPOS[domain]) {
    result.suggestion = `${local}@${DOMAIN_TYPOS[domain]}`;
    result.flags.push("possible_typo");
  }
  
  // 3. Disposable check
  if (DISPOSABLE_DOMAINS.has(domain)) {
    result.is_disposable = true;
    result.status = "invalid";
    result.score = 5;
    result.flags.push("disposable");
    return result;
  }
  
  // 4. Role-based check
  const localClean = local.replace(/[^a-z]/g, "");
  if (ROLE_PREFIXES.has(localClean) || ROLE_PREFIXES.has(local)) {
    result.is_role_based = true;
    result.flags.push("role_based");
  }
  
  // 5. Free provider check
  if (FREE_PROVIDERS.has(domain)) {
    result.is_free_provider = true;
    result.flags.push("free_provider");
  }
  
  // 6. MX record check
  const mx = await checkMxRecords(domain);
  result.mx_valid = mx.valid;
  if (mx.valid) {
    result.flags.push("mx_valid");
  } else {
    result.flags.push("no_mx_records");
    result.status = "invalid";
    result.score = 10;
    return result;
  }
  
  // 7. Score calculation
  let score = 50; // Base score for syntactically valid email with MX records
  
  if (mx.valid) score += 25;
  if (result.is_disposable) score -= 45;
  if (result.is_role_based) score -= 15;
  if (result.is_free_provider) score -= 5; // Slight penalty for B2B context
  if (result.suggestion) score -= 10; // Possible typo
  
  // Domain reputation heuristic — well-known providers get a boost
  if (FREE_PROVIDERS.has(domain)) {
    score += 10; // Known providers definitely accept email
  }
  
  result.score = Math.max(0, Math.min(100, score));
  
  // 8. Determine final status
  if (result.score >= 70) {
    result.status = "valid";
  } else if (result.score >= 40) {
    result.status = "risky";
  } else {
    result.status = "invalid";
  }
  
  // Role-based emails are always "risky" at best for cold outreach
  if (result.is_role_based && result.status === "valid") {
    result.status = "risky";
  }
  
  return result;
}

// ── Batch Verification (with concurrency control) ──
export async function verifyEmailBatch(
  emails: { id: string; email: string }[],
  concurrency = 10,
): Promise<Map<string, EmailVerification>> {
  const results = new Map<string, EmailVerification>();
  
  // Pre-compute: group by domain to batch MX lookups
  const domainGroups = new Map<string, { id: string; email: string }[]>();
  for (const entry of emails) {
    if (!entry.email) continue;
    const domain = entry.email.split("@")[1]?.toLowerCase();
    if (!domain) continue;
    if (!domainGroups.has(domain)) domainGroups.set(domain, []);
    domainGroups.get(domain)!.push(entry);
  }
  
  // Pre-fetch all MX records in parallel (deduplicated by domain)
  const domains = [...domainGroups.keys()];
  const MX_BATCH = concurrency;
  for (let i = 0; i < domains.length; i += MX_BATCH) {
    const batch = domains.slice(i, i + MX_BATCH);
    await Promise.allSettled(batch.map(d => checkMxRecords(d)));
  }
  
  // Now verify each email (MX results are cached)
  const BATCH_SIZE = concurrency;
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async ({ id, email }) => {
        const verification = await verifyEmail(email);
        return { id, verification };
      })
    );
    
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.set(r.value.id, r.value.verification);
      }
    }
  }
  
  return results;
}

// ── Email Pattern Guessing for Leads Missing Email ──
// Uses detected domain patterns from existing known emails to guess emails for other leads
export async function guessEmails(
  leadsWithoutEmail: { id: string; first_name: string; last_name: string; domain: string }[],
  knownEmails: { email: string; first_name: string; last_name: string; domain: string }[],
): Promise<Map<string, { email: string; pattern: PatternType; confidence: number }>> {
  const results = new Map<string, { email: string; pattern: PatternType; confidence: number }>();
  
  if (leadsWithoutEmail.length === 0) return results;
  
  // Group known emails by domain to detect patterns
  const domainEmails = new Map<string, { email: string; first_name: string; last_name: string }[]>();
  for (const known of knownEmails) {
    if (!known.email || !known.domain) continue;
    const d = known.domain.toLowerCase();
    if (!domainEmails.has(d)) domainEmails.set(d, []);
    domainEmails.get(d)!.push(known);
  }
  
  // Detect pattern per domain
  const domainPatterns = new Map<string, PatternType | null>();
  for (const [domain, emails] of domainEmails) {
    const pattern = detectDomainPattern(emails);
    if (pattern) {
      domainPatterns.set(domain, pattern);
    }
  }
  
  // Pre-check MX records for all unique domains
  const uniqueDomains = [...new Set(leadsWithoutEmail.map(l => l.domain.toLowerCase()))];
  await Promise.allSettled(uniqueDomains.map(d => checkMxRecords(d)));
  
  // Generate candidates for each lead
  for (const lead of leadsWithoutEmail) {
    if (!lead.first_name || !lead.last_name || !lead.domain) continue;
    
    const domain = lead.domain.toLowerCase();
    
    // Check if domain has valid MX records
    const mx = await checkMxRecords(domain);
    if (!mx.valid) continue; // Can't receive email, skip
    
    // Get detected pattern for this domain
    const detectedPattern = domainPatterns.get(domain) || null;
    
    // Generate candidates
    const candidates = generateEmailCandidates(
      lead.first_name,
      lead.last_name,
      domain,
      detectedPattern,
    );
    
    if (candidates.length > 0) {
      // Use the highest-confidence candidate
      const best = candidates[0];
      
      // Only use if confidence is reasonable
      if (best.confidence >= 20 || detectedPattern) {
        results.set(lead.id, best);
      }
    }
  }
  
  return results;
}
