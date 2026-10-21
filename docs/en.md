# Amber Electric

This integration connects Gladys to your **Amber Electric** account (Australia)
and brings in the price of your electricity, live and forecast, so your scenes
can run the pool pump, the hot water or the car charger when power is cheap,
and stop them before a price spike.

It talks to the Amber cloud only (it is tagged **cloud**): there is nothing to
install on your network.

## What you get

- One device per Amber site (one meter, shown with its NMI), with:
  - the **electricity price** you pay right now, in $/kWh;
  - the **wholesale spot price**;
  - the **controlled load price**, if your meter has a controlled load (hot
    water, for instance);
  - the **feed-in price**, if you export solar: what you **earn** per kWh
    exported. It is negative when exporting costs you money;
  - the **renewable share** of the grid, in %.
- Three scene triggers, two scene actions and a dashboard widget (Gladys 5.1 or
  later).

## Before you start

You need an Amber Electric account with at least one active site, and a
personal API token.

### Create your API token

1. Log in to the Amber web app: [app.amber.com.au](https://app.amber.com.au).
2. Open the **Developers** page
   ([app.amber.com.au/developers](https://app.amber.com.au/developers/)).
3. Click **Generate a new token**, give it a name (for example `Gladys`) and
   copy it. Amber shows it only once.

The token only gives read access to your sites and prices. You can revoke it on
the same page at any time.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Paste the token in **Amber API token**.
3. **Site**: leave it empty to follow every active site of the account. To
   follow only one, type its Amber id or its NMI (the **Test the connection**
   button lists them).
4. **Refresh interval**: 300 seconds (5 minutes) by default. Amber publishes a
   new price every 5 minutes and limits the number of calls: there is no point
   going faster, and one minute is the minimum.
5. **Forecast horizon**: how many hours of forecast prices are read, for the
   chart of the widget and the cheapest window. 12 hours by default.
6. Save, then press **Test the connection**: it lists your sites and shows the
   price right now.
7. Open the **Discovery** tab and add your site: its features start filling in
   at the next refresh.

Reads are aligned on Amber's intervals (a few seconds after :00, :05, :10…), so
the price in Gladys changes at the same time as in the Amber app.

## The devices

| Feature                | Unit  | What it is                                           |
| ---------------------- | ----- | ---------------------------------------------------- |
| Electricity price      | $/kWh | What you pay now, network fees and GST included      |
| Wholesale spot price   | $/kWh | The NEM market price behind it                       |
| Controlled load price  | $/kWh | Only if your meter has a controlled load             |
| Feed-in price          | $/kWh | What you earn per kWh exported (negative = it costs) |
| Renewables in the grid | %     | Share of renewable power in your region right now    |

The features keep their history: the standard Gladys charts show how the price
moved over the day. A value is only sent to Gladys when it changes (and every
30 minutes otherwise).

You can use these features in the standard **device state** trigger of the
scenes: "when the electricity price goes above 0.30 $/kWh…".

## Scenes

The integration adds its own cards to the scene editor (Gladys 5.1 or later),
under the **Integrations** category.

### Triggers

- **The electricity price level changes** — fires when Amber's price level
  moves: extremely low, very low, low, average, high or spike. Optionally pick
  the site and the new levels that should start the scene. The following
  actions can read `{{triggerEvent.data.level}}`,
  `{{triggerEvent.data.previous_level}}` and `{{triggerEvent.data.price}}`.
- **A price spike is possible, starts or ends** — fires when the spike status
  moves between none, possible and spike in progress. Pick "spike possible" to
  get ready (pre-cool the house), "no spike (ended)" to resume.
- **Exporting to the grid starts or stops paying** — fires when the feed-in
  price crosses zero: exporting solar starts to cost money (curtail the
  inverter, charge the battery, run the pool pump) or pays again.

A trigger fires once per change, never on every refresh. The first read after
the integration starts only records the current state: a restart does not
replay the triggers.

### Actions

- **Read the current electricity price** — gives the following actions the
  price now (`price`), the spot price, the level (`level`), the spike status
  (`spike_status`), the renewable share, whether the price is still an
  estimate, and the tariff period. Choose the price to read: electricity
  bought, controlled load or feed-in. `available` is false when the site has no
  such channel.
- **Find the cheapest time to run** — give a run time (60 minutes by default)
  and a horizon (the next 12 hours by default): the action answers
  `starts_in_minutes`, `start_time` and `end_time` (UTC), and the
  `average_price` of that window. `found` is false when the forecast is too
  short. Example: "every evening at 21:00, find the cheapest 2 hours in the next
  10 hours, then send me a message: start the dishwasher in
  `starts_in_minutes` minutes".

## Dashboard

Add the **Amber prices** widget to a dashboard. It shows:

- the price now, the feed-in price and the renewable share, in c/kWh as in the
  Amber app, colored by price level;
- the forecast chart, with the cheapest hour and the spikes marked;
- the price level, the spike status and the tariff period;
- a **Refresh** button that reads the prices again at once.

In the widget settings, pick the site to show (the first one when left empty).

## Troubleshooting

- **"Amber refused the API token"**: the token was revoked or mistyped. Create
  a new one on the Developers page and paste it again.
- **"No site of this Amber account has the id typed in the Site field"**: empty
  the field, or copy an id given by **Test the connection**.
- **"This Amber account has no active site yet"**: Amber does not supply your
  meter yet (the site is pending). Prices appear once it is active.
- **"Amber limits the number of calls"**: the reads pause for a few minutes. If
  it keeps happening (another tool uses the same token), raise the refresh
  interval.
- **The features stay empty**: add the site from the **Discovery** tab first.
- For more detail, turn on **Detailed logs** in the configuration and look at
  the integration logs. Your token is never written to the logs.
