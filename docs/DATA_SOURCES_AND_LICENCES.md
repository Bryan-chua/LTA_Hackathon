# Data Sources, Attribution, and Use

| Source | Use | Precision and limitations | Attribution / terms action |
|---|---|---|---|
| OneMap | Singapore address search and public-transport itineraries | Routing availability and returned station identifiers vary; unknown mappings remain unknown | Keep credentials server-side. Review [OneMap API documentation](https://www.onemap.gov.sg/apidocs/) and current terms before public launch. |
| LTA DataMall | Train service alerts and passenger-volume crowding signals | Crowding can be forecast, current, unavailable, or `NA`; missing values are never presented as low | Display source and timestamp. Follow the current [DataMall terms and API guide](https://datamall.lta.gov.sg/content/datamall/en.html). |
| LTA DataMall `v3/BusArrival`, `BusStops`, `BusRoutes` | Next-bus ETA and vehicle load for bus legs; cached stop/route reference data for matching a leg to official bus-stop codes | `SEA`/`SDA`/`LSD` describe bus-vehicle load only, never MRT station crowding; a missing, stale, or failed reading is shown as unavailable, never a favourable ETA or load. `BusArrival` is queried only for stops used by current candidate journeys, never bulk-fetched. Bus-stop and bus-vehicle accessibility are unverified by this data and are never inferred from it. | Display source and timestamp. Follow the current [DataMall terms and API guide](https://datamall.lta.gov.sg/content/datamall/en.html). |
| data.gov.sg | Two-hour area weather forecast | Area-level forecast matched to walking-leg midpoint; it is not street-level rainfall | Preserve issue/validity times and source. Review the dataset's current terms on [data.gov.sg](https://data.gov.sg/). |
| OpenStreetMap contributors | Map context and offline schematic attribution | Third-party tiles are network-only and may be unavailable | Display `© OpenStreetMap contributors` and follow the [OSM copyright and attribution guidance](https://www.openstreetmap.org/copyright). |
| Checked-in replay fixtures | Normal, unplanned EWL disruption, planned EWL work, demand sensitivity | Reproducible judging examples; not current network conditions | Always label replay/synthetic data. Never show it as live. |

Provider payloads are normalized in memory. Raw responses, credentials, authorization headers, and tile data are not placed in IndexedDB or PostgreSQL.
