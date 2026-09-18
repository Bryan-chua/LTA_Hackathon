import type { Coordinate, Journey, JourneyLeg, JourneyLegGeometrySection, Place, Routine, Scenario, TravelCondition } from "./domain";

const place = (name: string, shortName: string, lng: number, lat: number): Place => ({
  name,
  shortName,
  coordinate: { lng, lat },
});

export const home = place("Home, Tampines Street 45", "Home", 103.9466, 1.3583);
export const tampines = place("Tampines MRT", "Tampines", 103.9451, 1.3530);
export const payaLebar = place("Paya Lebar MRT", "Paya Lebar", 103.8931, 1.3174);
export const cityHall = place("City Hall MRT", "City Hall", 103.8520, 1.2932);
export const rafflesPlace = place("Raffles Place MRT", "Raffles Place", 103.8519, 1.2840);
export const office = place("Office, Raffles Place", "Office", 103.8507, 1.2814);
export const macpherson = place("MacPherson MRT", "MacPherson", 103.8893, 1.3265);
export const downtown = place("Downtown MRT", "Downtown", 103.8528, 1.2794);

const walkLeg = (
  id: string,
  sequence: number,
  from: Place,
  to: Place,
  durationMinutes: number,
  instruction: string,
): JourneyLeg => ({
  id,
  sequence,
  mode: "walk",
  from,
  to,
  instruction,
  durationMinutes,
  uncertaintyMinutes: 2,
  geometry: [from.coordinate, to.coordinate],
});

const railLeg = (
  id: string,
  sequence: number,
  from: Place,
  to: Place,
  lineId: string,
  lineName: string,
  stationCodes: string[],
  durationMinutes: number,
  instruction: string,
  geometry: Coordinate[],
  geometrySections?: JourneyLegGeometrySection[],
): JourneyLeg => ({
  id,
  sequence,
  mode: "rail",
  from,
  to,
  lineId,
  lineName,
  stationCodes,
  instruction,
  durationMinutes,
  uncertaintyMinutes: 4,
  crowding: "moderate",
  geometry,
  geometrySections,
});

const routine: Routine = {
  id: "rachel-weekday",
  travellerName: "Rachel",
  origin: home,
  destination: office,
  departureTime: "07:40",
  arrivalDeadline: "08:45",
  weekdays: [1, 2, 3, 4, 5],
  enabled: true,
};

const usualLegs: JourneyLeg[] = [
  walkLeg("usual-walk-start", 0, home, tampines, 7, "Walk to Tampines MRT via Street 45."),
  railLeg(
    "usual-ewl",
    1,
    tampines,
    rafflesPlace,
    "EWL",
    "East-West Line",
    ["EW2", "EW3", "EW4", "EW5", "EW6", "EW7", "EW8", "EW9", "EW10", "EW11", "EW12", "EW13", "EW14"],
    42,
    "Take the East-West Line towards Tuas Link.",
    [
      tampines.coordinate,
      { lng: 103.9299, lat: 1.3240 },
      payaLebar.coordinate,
      { lng: 103.8717, lat: 1.3074 },
      { lng: 103.8557, lat: 1.3009 },
      cityHall.coordinate,
      rafflesPlace.coordinate,
    ],
    [
      {
        id: "ewl-tampines-paya-lebar",
        fromStationCode: "EW2",
        toStationCode: "EW8",
        geometry: [
          tampines.coordinate,
          { lng: 103.9299, lat: 1.3240 },
          payaLebar.coordinate,
        ],
      },
      {
        id: "ewl-paya-lebar-city-hall",
        fromStationCode: "EW8",
        toStationCode: "EW13",
        geometry: [
          payaLebar.coordinate,
          { lng: 103.8717, lat: 1.3074 },
          { lng: 103.8557, lat: 1.3009 },
          cityHall.coordinate,
        ],
      },
      {
        id: "ewl-city-hall-raffles-place",
        fromStationCode: "EW13",
        toStationCode: "EW14",
        geometry: [cityHall.coordinate, rafflesPlace.coordinate],
      },
    ],
  ),
  walkLeg("usual-walk-end", 2, rafflesPlace, office, 5, "Use Exit F and walk to the office."),
];

const usualJourney: Journey = {
  id: "usual-ewl-route",
  name: "Usual route via EWL",
  origin: home,
  destination: office,
  departureAt: "2026-09-18T07:40:00+08:00",
  arrival: { p50: "08:41", earliest: "08:38", latest: "08:44" },
  legs: usualLegs,
  source: "fixture",
  generatedAt: "07:30",
};

const affectedJourney: Journey = {
  ...usualJourney,
  id: "usual-ewl-route-affected",
  arrival: { p50: "08:57", earliest: "08:51", latest: "09:05" },
  legs: usualJourney.legs.map((leg) =>
    leg.mode === "rail" ? { ...leg, crowding: "high" as const } : leg,
  ),
};

const alternativeJourney: Journey = {
  id: "recommended-dtl-route",
  name: "Downtown Line alternative",
  origin: home,
  destination: office,
  departureAt: "2026-09-18T07:35:00+08:00",
  arrival: { p50: "08:42", earliest: "08:38", latest: "08:46" },
  source: "fixture",
  generatedAt: "07:30",
  legs: [
    walkLeg("alt-walk-start", 0, home, tampines, 7, "Walk to Tampines MRT and enter via Exit B."),
    railLeg(
      "alt-dtl",
      1,
      tampines,
      downtown,
      "DTL",
      "Downtown Line",
      ["DT32", "DT26", "DT21", "DT17"],
      48,
      "Take the Downtown Line towards Bukit Panjang and alight at Downtown.",
      [
        tampines.coordinate,
        { lng: 103.9384, lat: 1.3455 },
        { lng: 103.9183, lat: 1.3354 },
        macpherson.coordinate,
        { lng: 103.8714, lat: 1.3143 },
        { lng: 103.8504, lat: 1.2989 },
        downtown.coordinate,
      ],
    ),
    walkLeg("alt-walk-end", 2, downtown, office, 9, "Walk via Marina View to Raffles Place."),
  ],
};

const disruption: TravelCondition = {
  id: "replay-ewl-2026-09-18",
  kind: "train_disruption",
  severity: "major",
  title: "Longer travel time between Paya Lebar and City Hall",
  lineIds: ["EWL"],
  stationCodes: ["EW8", "EW13"],
  validFrom: "2026-09-18T07:18:00+08:00",
  validTo: "2026-09-18T09:30:00+08:00",
  source: "DataMall-shaped fixture",
  observedAt: "2026-09-18T07:28:00+08:00",
  isReplay: true,
};

export const scenarios: Record<Scenario["id"], Scenario> = {
  normal: {
    id: "normal",
    label: "Normal morning",
    isReplay: false,
    routine,
    usualJourney,
    conditions: [],
    updatedAt: "07:30",
  },
  "ewl-disruption": {
    id: "ewl-disruption",
    label: "EWL disruption replay",
    isReplay: true,
    routine,
    usualJourney: affectedJourney,
    recommendedJourney: alternativeJourney,
    conditions: [disruption],
    updatedAt: "07:30",
  },
};
