// -----------------------------------------------------------------------------
// How Amber's vocabulary reads in the four languages of the Gladys interface,
// and the color each value gets on the dashboard. The keys are Amber's own
// (and the values of the scene trigger filters): never rename them.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';

export const LEVEL_LABELS = {
  extremelyLow: {
    en: 'Extremely low',
    fr: 'Extrêmement bas',
    de: 'Extrem niedrig',
    es: 'Extremadamente bajo',
  },
  veryLow: { en: 'Very low', fr: 'Très bas', de: 'Sehr niedrig', es: 'Muy bajo' },
  low: { en: 'Low', fr: 'Bas', de: 'Niedrig', es: 'Bajo' },
  neutral: { en: 'Average', fr: 'Moyen', de: 'Durchschnittlich', es: 'Medio' },
  high: { en: 'High', fr: 'Élevé', de: 'Hoch', es: 'Alto' },
  spike: { en: 'Spike', fr: 'Pic', de: 'Preisspitze', es: 'Pico' },
};

export const LEVEL_COLORS = {
  extremelyLow: WIDGET_COLORS.SUCCESS,
  veryLow: WIDGET_COLORS.SUCCESS,
  low: WIDGET_COLORS.SUCCESS,
  neutral: WIDGET_COLORS.NEUTRAL,
  high: WIDGET_COLORS.WARNING,
  spike: WIDGET_COLORS.DANGER,
};

export const SPIKE_LABELS = {
  none: { en: 'None', fr: 'Aucun', de: 'Keine', es: 'Ninguno' },
  potential: { en: 'Possible', fr: 'Possible', de: 'Möglich', es: 'Posible' },
  spike: { en: 'In progress', fr: 'En cours', de: 'Läuft', es: 'En curso' },
};

export const SPIKE_COLORS = {
  none: WIDGET_COLORS.SUCCESS,
  potential: WIDGET_COLORS.WARNING,
  spike: WIDGET_COLORS.DANGER,
};

export const PERIOD_LABELS = {
  offPeak: { en: 'Off-peak', fr: 'Heures creuses', de: 'Nebenzeit', es: 'Valle' },
  shoulder: { en: 'Shoulder', fr: 'Heures intermédiaires', de: 'Mittelzeit', es: 'Llano' },
  solarSponge: {
    en: 'Solar sponge',
    fr: 'Créneau solaire',
    de: 'Solarfenster',
    es: 'Franja solar',
  },
  peak: { en: 'Peak', fr: 'Heures pleines', de: 'Hauptzeit', es: 'Punta' },
};

export const CHANNEL_LABELS = {
  general: { en: 'Electricity', fr: 'Électricité', de: 'Strom', es: 'Electricidad' },
  controlledLoad: {
    en: 'Controlled load',
    fr: 'Charge pilotée',
    de: 'Steuerbare Last',
    es: 'Carga controlada',
  },
  feedIn: { en: 'Feed-in', fr: 'Injection', de: 'Einspeisung', es: 'Inyección' },
};
