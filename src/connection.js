// -----------------------------------------------------------------------------
// What the user reads about the link to Amber: the connection status of the
// Configuration screen, and the answer of the "Test the connection" button.
//
// Every message says what to DO, in the four languages of the Gladys
// interface: "the token was refused, create a new one" rather than "401".
// -----------------------------------------------------------------------------

import { AMBER_ERRORS } from './amber/client.js';
import { CHANNELS } from './amber/prices.js';
import { LEVEL_LABELS } from './amber/labels.js';
import { localize, pick } from './i18n.js';

/** Our own error codes, next to the API ones. */
export const SITE_ERRORS = {
  SITE_NOT_FOUND: 'site_not_found',
  NO_SITE: 'no_site',
};

const MESSAGES = {
  [AMBER_ERRORS.NO_TOKEN]: {
    en: 'Paste your Amber API token in the configuration (app.amber.com.au, Developers).',
    fr: "Collez votre jeton d'API Amber dans la configuration (app.amber.com.au, Developers).",
    de: 'Füge dein Amber-API-Token in die Konfiguration ein (app.amber.com.au, Developers).',
    es: 'Pegue su token de API de Amber en la configuración (app.amber.com.au, Developers).',
  },
  [AMBER_ERRORS.UNAUTHORIZED]: {
    en: 'Amber refused the API token: create a new one on app.amber.com.au and paste it again.',
    fr: "Amber a refusé le jeton d'API : créez-en un nouveau sur app.amber.com.au et recollez-le.",
    de: 'Amber hat das API-Token abgelehnt: Erstelle auf app.amber.com.au ein neues und füge es erneut ein.',
    es: 'Amber rechazó el token de API: cree uno nuevo en app.amber.com.au y vuelva a pegarlo.',
  },
  [AMBER_ERRORS.RATE_LIMITED]: {
    en: 'Amber limits the number of calls: the prices are read again in a few minutes. Raise the refresh interval if this keeps happening.',
    fr: "Amber limite le nombre d'appels : les prix seront relus dans quelques minutes. Augmentez l'intervalle de rafraîchissement si cela se répète.",
    de: 'Amber begrenzt die Anzahl der Abfragen: Die Preise werden in ein paar Minuten erneut gelesen. Erhöhe das Aktualisierungsintervall, wenn das öfter passiert.',
    es: 'Amber limita el número de llamadas: los precios se volverán a leer en unos minutos. Aumente el intervalo de actualización si se repite.',
  },
  [AMBER_ERRORS.NETWORK]: {
    en: 'Amber cannot be reached: check the internet access of the Gladys server.',
    fr: "Amber est injoignable : vérifiez l'accès à Internet du serveur Gladys.",
    de: 'Amber ist nicht erreichbar: Prüfe den Internetzugang des Gladys-Servers.',
    es: 'No se puede contactar con Amber: compruebe el acceso a Internet del servidor de Gladys.',
  },
  [AMBER_ERRORS.SERVER]: {
    en: 'The Amber service is having trouble: the prices are read again at the next refresh.',
    fr: 'Le service Amber rencontre un problème : les prix seront relus au prochain rafraîchissement.',
    de: 'Der Amber-Dienst hat Probleme: Die Preise werden bei der nächsten Aktualisierung erneut gelesen.',
    es: 'El servicio de Amber tiene problemas: los precios se volverán a leer en la próxima actualización.',
  },
  [AMBER_ERRORS.BAD_RESPONSE]: {
    en: 'Amber gave an answer the integration cannot read: check the integration logs.',
    fr: "Amber a donné une réponse illisible pour l'intégration : consultez les journaux de l'intégration.",
    de: 'Amber hat eine Antwort gegeben, die die Integration nicht lesen kann: Prüfe die Protokolle der Integration.',
    es: 'Amber dio una respuesta que la integración no puede leer: revise los registros de la integración.',
  },
  [AMBER_ERRORS.NOT_FOUND]: {
    en: 'Amber does not know this site: empty the Site field, or copy the id given by "Test the connection".',
    fr: "Amber ne connaît pas ce site : videz le champ Site, ou copiez l'identifiant donné par « Tester la connexion ».",
    de: 'Amber kennt diesen Standort nicht: Leere das Feld Standort oder kopiere die von „Verbindung testen“ angegebene ID.',
    es: 'Amber no conoce este sitio: vacíe el campo Sitio, o copie el identificador que da «Probar la conexión».',
  },
  [SITE_ERRORS.SITE_NOT_FOUND]: {
    en: 'No site of this Amber account has the id typed in the Site field: empty it, or copy one given by "Test the connection".',
    fr: "Aucun site de ce compte Amber n'a l'identifiant saisi dans le champ Site : videz-le, ou copiez-en un donné par « Tester la connexion ».",
    de: 'Kein Standort dieses Amber-Kontos hat die im Feld Standort eingegebene ID: Leere es oder kopiere eine von „Verbindung testen“.',
    es: 'Ningún sitio de esta cuenta de Amber tiene el identificador escrito en el campo Sitio: vacíelo, o copie uno de «Probar la conexión».',
  },
  [SITE_ERRORS.NO_SITE]: {
    en: 'This Amber account has no active site yet: the prices appear once Amber supplies your meter.',
    fr: "Ce compte Amber n'a pas encore de site actif : les prix apparaîtront dès qu'Amber alimentera votre compteur.",
    de: 'Dieses Amber-Konto hat noch keinen aktiven Standort: Die Preise erscheinen, sobald Amber deinen Zähler beliefert.',
    es: 'Esta cuenta de Amber aún no tiene ningún sitio activo: los precios aparecerán cuando Amber suministre su contador.',
  },
};

/**
 * The message of a failure, `{ en, fr, de, es }`.
 * @param {Error & { code?: string }} err
 */
export function describeError(err) {
  return MESSAGES[err?.code] ?? MESSAGES[AMBER_ERRORS.BAD_RESPONSE];
}

function formatPrice(dollars, language) {
  const locale = { en: 'en-AU', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-AU';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(dollars)} $/kWh`;
}

/**
 * The answer of "Test the connection": every site of the account, its id
 * (what the Site field takes) and, for the followed ones, the price now.
 * @param {object[]} sites every site of the account (GET /sites)
 * @param {Map<string, object>} snapshots price snapshots of the followed sites
 * @param {Set<string>} followedIds ids of the sites the integration follows
 */
export function connectionReport(sites, snapshots, followedIds) {
  return localize((language) => {
    const head = pick(language, {
      en: `Connected to Amber: ${sites.length} site(s).`,
      fr: `Connecté à Amber : ${sites.length} site(s).`,
      de: `Mit Amber verbunden: ${sites.length} Standort(e).`,
      es: `Conectado a Amber: ${sites.length} sitio(s).`,
    });
    const lines = sites.map((site) => {
      const general = snapshots.get(site.id)?.channels?.[CHANNELS.GENERAL];
      const followed = followedIds.has(site.id);
      const price = general
        ? ` — ${formatPrice(general.price, language)}, ${pick(language, LEVEL_LABELS[general.level])}`
        : '';
      const flag = followed
        ? ''
        : pick(language, {
            en: ' (not followed)',
            fr: ' (non suivi)',
            de: ' (nicht verfolgt)',
            es: ' (no seguido)',
          });
      return `NMI ${site.nmi} [${site.status}] id ${site.id}${flag}${price}`;
    });
    return [head, ...lines].join('\n');
  });
}
