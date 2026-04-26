export type CoverageTier = "standard" | "extended" | "remote" | "none";

export interface CoverageZone {
  tier: CoverageTier;
  cities: string[];
  deliveryDays: string;
  requiresPrepaid: boolean;
  note?: string;
}

export const COVERAGE: CoverageZone[] = [
  {
    tier: "standard",
    deliveryDays: "2-4 días hábiles",
    requiresPrepaid: false,
    cities: [
      "Bogotá",
      "Medellín",
      "Cali",
      "Barranquilla",
      "Cartagena",
      "Cúcuta",
      "Bucaramanga",
      "Pereira",
      "Manizales",
      "Armenia",
      "Ibagué",
      "Santa Marta",
      "Villavicencio",
      "Pasto",
      "Neiva",
      "Montería",
      "Sincelejo",
      "Valledupar",
      "Popayán",
      "Tunja",
      "Riohacha",
      "Quibdó",
      "Florencia",
      "Yopal",
      "Mocoa",
      "Arauca",
      "San José del Guaviare",
      "Soledad",
      "Soacha",
      "Bello",
      "Itagüí",
      "Envigado",
      "Sabaneta",
      "Rionegro",
      "Palmira",
      "Buenaventura",
      "Buga",
      "Cartago",
      "Tuluá",
      "Yumbo",
      "Girardot",
      "Fusagasugá",
      "Zipaquirá",
      "Chía",
      "Cajicá",
      "Madrid",
      "Funza",
      "Mosquera",
      "Facatativá",
      "Duitama",
      "Sogamoso",
      "Chiquinquirá",
      "Girardota",
      "Copacabana",
      "Caldas",
      "La Estrella",
      "Apartadó",
      "Turbo",
      "Lorica",
      "Cereté",
      "Magangué",
      "Aguachica",
      "Ocaña",
      "Pamplona",
      "Barrancabermeja",
      "San Gil",
      "Floridablanca",
      "Girón",
      "Piedecuesta",
      "Dosquebradas",
      "Santa Rosa de Cabal",
      "La Dorada",
      "Honda",
      "Espinal",
      "Melgar",
      "Chaparral",
      "La Tebaida",
      "Calarcá",
      "Jamundí",
      "Tumaco",
      "Ipiales",
      "Caicedonia",
      "Sevilla",
      "Roldanillo",
      "Maicao",
      "Uribia",
      "Ciénaga",
      "Fundación",
      "El Banco",
      "Plato",
      "Sahagún",
      "Planeta Rica",
      "Caucasia",
      "Necoclí",
      "Tierralta",
      "Montelíbano",
    ],
  },
  {
    tier: "extended",
    deliveryDays: "5-8 días hábiles",
    requiresPrepaid: true,
    note: "Por logística requiere pago anticipado",
    cities: ["San Andrés", "Providencia"],
  },
  {
    tier: "remote",
    deliveryDays: "5-10 días hábiles",
    requiresPrepaid: true,
    note: "Zona amazónica, requiere pago anticipado y confirmación previa",
    cities: [
      "Leticia",
      "Puerto Nariño",
      "Mitú",
      "Inírida",
      "Puerto Carreño",
    ],
  },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

export function findCoverage(cityInput: string): {
  zone: CoverageZone;
  city: string;
} | null {
  const q = norm(cityInput);
  for (const zone of COVERAGE) {
    const match = zone.cities.find((c) => norm(c) === q || norm(c).includes(q) || q.includes(norm(c)));
    if (match) return { zone, city: match };
  }
  return null;
}

export function isInternational(input: string): boolean {
  const q = norm(input);
  const intl = [
    "estados unidos", "usa", "espana", "mexico", "ecuador", "peru",
    "venezuela", "argentina", "chile", "panama", "miami", "madrid",
    "exterior", "internacional", "fuera del pais", "fuera de colombia",
  ];
  return intl.some((c) => q.includes(c));
}

export const COVERAGE_FALLBACK_NOTE =
  "Si no aparece tu municipio en cobertura estándar, lo enviamos por la transportadora más cercana. Confirmamos tiempos antes de despachar.";
