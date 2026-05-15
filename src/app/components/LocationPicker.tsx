import React, { useState, useRef, useEffect, useMemo } from 'react';
import { MapPin, ChevronDown, X, Search, Globe, Building2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ── Comprehensive country/state/city data ──

interface CountryData {
  name: string;
  code: string;
  hasStates?: boolean;
  states?: { name: string; cities: string[] }[];
  cities?: string[]; // For countries without states
}

const COUNTRIES: CountryData[] = [
  {
    name: 'United States', code: 'US', hasStates: true,
    states: [
      { name: 'Alabama', cities: ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile', 'Tuscaloosa'] },
      { name: 'Alaska', cities: ['Anchorage', 'Fairbanks', 'Juneau'] },
      { name: 'Arizona', cities: ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Chandler', 'Tempe', 'Gilbert'] },
      { name: 'Arkansas', cities: ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Bentonville'] },
      { name: 'California', cities: ['San Francisco', 'Los Angeles', 'San Diego', 'San Jose', 'Sacramento', 'Oakland', 'Palo Alto', 'Irvine', 'Santa Monica', 'Pasadena', 'Long Beach', 'Fresno', 'Bakersfield', 'Anaheim', 'Santa Clara', 'Mountain View', 'Sunnyvale', 'Redwood City', 'Menlo Park', 'Beverly Hills', 'Burbank', 'Glendale'] },
      { name: 'Colorado', cities: ['Denver', 'Colorado Springs', 'Aurora', 'Boulder', 'Fort Collins', 'Lakewood', 'Thornton'] },
      { name: 'Connecticut', cities: ['Hartford', 'Bridgeport', 'New Haven', 'Stamford', 'Waterbury', 'Greenwich'] },
      { name: 'Delaware', cities: ['Wilmington', 'Dover', 'Newark'] },
      { name: 'Florida', cities: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'St. Petersburg', 'Naples', 'Sarasota', 'West Palm Beach', 'Tallahassee', 'Boca Raton', 'Coral Gables'] },
      { name: 'Georgia', cities: ['Atlanta', 'Savannah', 'Augusta', 'Columbus', 'Athens', 'Marietta', 'Alpharetta', 'Roswell'] },
      { name: 'Hawaii', cities: ['Honolulu', 'Hilo', 'Kailua', 'Maui'] },
      { name: 'Idaho', cities: ['Boise', 'Meridian', 'Nampa', 'Idaho Falls'] },
      { name: 'Illinois', cities: ['Chicago', 'Aurora', 'Naperville', 'Rockford', 'Springfield', 'Evanston', 'Schaumburg'] },
      { name: 'Indiana', cities: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel'] },
      { name: 'Iowa', cities: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Iowa City'] },
      { name: 'Kansas', cities: ['Wichita', 'Overland Park', 'Kansas City', 'Topeka', 'Olathe'] },
      { name: 'Kentucky', cities: ['Louisville', 'Lexington', 'Bowling Green', 'Covington'] },
      { name: 'Louisiana', cities: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette'] },
      { name: 'Maine', cities: ['Portland', 'Bangor', 'Augusta'] },
      { name: 'Maryland', cities: ['Baltimore', 'Annapolis', 'Rockville', 'Bethesda', 'Silver Spring', 'Frederick'] },
      { name: 'Massachusetts', cities: ['Boston', 'Cambridge', 'Worcester', 'Springfield', 'Lowell', 'Quincy', 'Somerville'] },
      { name: 'Michigan', cities: ['Detroit', 'Grand Rapids', 'Ann Arbor', 'Lansing', 'Kalamazoo', 'Troy'] },
      { name: 'Minnesota', cities: ['Minneapolis', 'Saint Paul', 'Rochester', 'Bloomington', 'Duluth', 'Plymouth'] },
      { name: 'Mississippi', cities: ['Jackson', 'Gulfport', 'Hattiesburg', 'Biloxi'] },
      { name: 'Missouri', cities: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', 'Independence'] },
      { name: 'Montana', cities: ['Billings', 'Missoula', 'Great Falls', 'Bozeman'] },
      { name: 'Nebraska', cities: ['Omaha', 'Lincoln', 'Bellevue'] },
      { name: 'Nevada', cities: ['Las Vegas', 'Reno', 'Henderson', 'North Las Vegas'] },
      { name: 'New Hampshire', cities: ['Manchester', 'Nashua', 'Concord'] },
      { name: 'New Jersey', cities: ['Newark', 'Jersey City', 'Paterson', 'Trenton', 'Princeton', 'Hoboken', 'Edison'] },
      { name: 'New Mexico', cities: ['Albuquerque', 'Santa Fe', 'Las Cruces', 'Rio Rancho'] },
      { name: 'New York', cities: ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Syracuse', 'White Plains', 'Yonkers'] },
      { name: 'North Carolina', cities: ['Charlotte', 'Raleigh', 'Durham', 'Greensboro', 'Winston-Salem', 'Asheville', 'Wilmington', 'Cary'] },
      { name: 'North Dakota', cities: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot'] },
      { name: 'Ohio', cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton'] },
      { name: 'Oklahoma', cities: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow'] },
      { name: 'Oregon', cities: ['Portland', 'Salem', 'Eugene', 'Bend', 'Beaverton', 'Hillsboro'] },
      { name: 'Pennsylvania', cities: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Harrisburg', 'Erie', 'King of Prussia'] },
      { name: 'Rhode Island', cities: ['Providence', 'Warwick', 'Cranston', 'Newport'] },
      { name: 'South Carolina', cities: ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach'] },
      { name: 'South Dakota', cities: ['Sioux Falls', 'Rapid City', 'Aberdeen'] },
      { name: 'Tennessee', cities: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Murfreesboro'] },
      { name: 'Texas', cities: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Arlington', 'Plano', 'Frisco', 'Irving', 'McKinney', 'Round Rock'] },
      { name: 'Utah', cities: ['Salt Lake City', 'Provo', 'West Jordan', 'Ogden', 'Sandy', 'Lehi'] },
      { name: 'Vermont', cities: ['Burlington', 'Montpelier', 'Rutland'] },
      { name: 'Virginia', cities: ['Virginia Beach', 'Richmond', 'Norfolk', 'Arlington', 'Alexandria', 'Reston', 'McLean', 'Tysons'] },
      { name: 'Washington', cities: ['Seattle', 'Tacoma', 'Spokane', 'Bellevue', 'Redmond', 'Kirkland', 'Olympia', 'Vancouver'] },
      { name: 'West Virginia', cities: ['Charleston', 'Huntington', 'Morgantown'] },
      { name: 'Wisconsin', cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine'] },
      { name: 'Wyoming', cities: ['Cheyenne', 'Casper', 'Laramie', 'Jackson'] },
      { name: 'Washington, D.C.', cities: ['Washington'] },
    ],
  },
  {
    name: 'Canada', code: 'CA', hasStates: true,
    states: [
      { name: 'Ontario', cities: ['Toronto', 'Ottawa', 'Mississauga', 'Hamilton', 'London', 'Markham', 'Waterloo', 'Kitchener'] },
      { name: 'Quebec', cities: ['Montreal', 'Quebec City', 'Laval', 'Gatineau', 'Sherbrooke'] },
      { name: 'British Columbia', cities: ['Vancouver', 'Victoria', 'Burnaby', 'Surrey', 'Kelowna'] },
      { name: 'Alberta', cities: ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge'] },
      { name: 'Manitoba', cities: ['Winnipeg', 'Brandon'] },
      { name: 'Saskatchewan', cities: ['Saskatoon', 'Regina'] },
      { name: 'Nova Scotia', cities: ['Halifax', 'Dartmouth'] },
      { name: 'New Brunswick', cities: ['Moncton', 'Saint John', 'Fredericton'] },
      { name: 'Newfoundland and Labrador', cities: ["St. John's", 'Corner Brook'] },
      { name: 'Prince Edward Island', cities: ['Charlottetown'] },
    ],
  },
  {
    name: 'United Kingdom', code: 'GB', hasStates: true,
    states: [
      { name: 'England', cities: ['London', 'Manchester', 'Birmingham', 'Liverpool', 'Leeds', 'Bristol', 'Sheffield', 'Newcastle', 'Nottingham', 'Cambridge', 'Oxford', 'Brighton', 'Reading', 'Southampton'] },
      { name: 'Scotland', cities: ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Inverness'] },
      { name: 'Wales', cities: ['Cardiff', 'Swansea', 'Newport'] },
      { name: 'Northern Ireland', cities: ['Belfast', 'Derry', 'Lisburn'] },
    ],
  },
  {
    name: 'Australia', code: 'AU', hasStates: true,
    states: [
      { name: 'New South Wales', cities: ['Sydney', 'Newcastle', 'Wollongong', 'Parramatta'] },
      { name: 'Victoria', cities: ['Melbourne', 'Geelong', 'Ballarat'] },
      { name: 'Queensland', cities: ['Brisbane', 'Gold Coast', 'Sunshine Coast', 'Cairns', 'Townsville'] },
      { name: 'Western Australia', cities: ['Perth', 'Fremantle', 'Mandurah'] },
      { name: 'South Australia', cities: ['Adelaide', 'Mount Gambier'] },
      { name: 'Tasmania', cities: ['Hobart', 'Launceston'] },
      { name: 'Australian Capital Territory', cities: ['Canberra'] },
      { name: 'Northern Territory', cities: ['Darwin', 'Alice Springs'] },
    ],
  },
  {
    name: 'Germany', code: 'DE', hasStates: true,
    states: [
      { name: 'Bavaria', cities: ['Munich', 'Nuremberg', 'Augsburg'] },
      { name: 'Berlin', cities: ['Berlin'] },
      { name: 'Hamburg', cities: ['Hamburg'] },
      { name: 'Hesse', cities: ['Frankfurt', 'Wiesbaden', 'Darmstadt'] },
      { name: 'North Rhine-Westphalia', cities: ['Cologne', 'Düsseldorf', 'Dortmund', 'Essen', 'Bonn'] },
      { name: 'Baden-Württemberg', cities: ['Stuttgart', 'Heidelberg', 'Mannheim', 'Karlsruhe', 'Freiburg'] },
      { name: 'Lower Saxony', cities: ['Hanover', 'Braunschweig', 'Göttingen'] },
      { name: 'Saxony', cities: ['Dresden', 'Leipzig'] },
    ],
  },
  {
    name: 'India', code: 'IN', hasStates: true,
    states: [
      { name: 'Maharashtra', cities: ['Mumbai', 'Pune', 'Nagpur', 'Nashik'] },
      { name: 'Karnataka', cities: ['Bangalore', 'Mysore', 'Hubli'] },
      { name: 'Tamil Nadu', cities: ['Chennai', 'Coimbatore', 'Madurai'] },
      { name: 'Delhi', cities: ['New Delhi', 'Delhi'] },
      { name: 'Telangana', cities: ['Hyderabad', 'Warangal'] },
      { name: 'West Bengal', cities: ['Kolkata', 'Howrah'] },
      { name: 'Gujarat', cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot'] },
      { name: 'Uttar Pradesh', cities: ['Lucknow', 'Noida', 'Agra', 'Varanasi', 'Kanpur'] },
      { name: 'Rajasthan', cities: ['Jaipur', 'Udaipur', 'Jodhpur'] },
      { name: 'Kerala', cities: ['Kochi', 'Thiruvananthapuram', 'Kozhikode'] },
      { name: 'Haryana', cities: ['Gurgaon', 'Faridabad', 'Chandigarh'] },
      { name: 'Punjab', cities: ['Chandigarh', 'Ludhiana', 'Amritsar'] },
    ],
  },
  {
    name: 'Brazil', code: 'BR', hasStates: true,
    states: [
      { name: 'São Paulo', cities: ['São Paulo', 'Campinas', 'Santos', 'Guarulhos'] },
      { name: 'Rio de Janeiro', cities: ['Rio de Janeiro', 'Niterói'] },
      { name: 'Minas Gerais', cities: ['Belo Horizonte', 'Uberlândia'] },
      { name: 'Paraná', cities: ['Curitiba', 'Londrina', 'Maringá'] },
      { name: 'Rio Grande do Sul', cities: ['Porto Alegre', 'Caxias do Sul'] },
      { name: 'Bahia', cities: ['Salvador', 'Feira de Santana'] },
      { name: 'Federal District', cities: ['Brasília'] },
      { name: 'Pernambuco', cities: ['Recife', 'Olinda'] },
      { name: 'Ceará', cities: ['Fortaleza'] },
    ],
  },
  {
    name: 'Mexico', code: 'MX', hasStates: true,
    states: [
      { name: 'Mexico City', cities: ['Mexico City'] },
      { name: 'Jalisco', cities: ['Guadalajara', 'Puerto Vallarta'] },
      { name: 'Nuevo León', cities: ['Monterrey', 'San Pedro Garza García'] },
      { name: 'State of Mexico', cities: ['Toluca', 'Naucalpan'] },
      { name: 'Querétaro', cities: ['Querétaro'] },
      { name: 'Puebla', cities: ['Puebla'] },
      { name: 'Yucatán', cities: ['Mérida'] },
      { name: 'Baja California', cities: ['Tijuana', 'Mexicali', 'Ensenada'] },
    ],
  },
  {
    name: 'France', code: 'FR',
    cities: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Bordeaux', 'Lille', 'Montpellier', 'Rennes'],
  },
  {
    name: 'Netherlands', code: 'NL',
    cities: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven', 'Groningen', 'Tilburg'],
  },
  {
    name: 'Spain', code: 'ES',
    cities: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao', 'Málaga', 'Zaragoza', 'Palma'],
  },
  {
    name: 'Italy', code: 'IT',
    cities: ['Rome', 'Milan', 'Naples', 'Turin', 'Florence', 'Bologna', 'Venice', 'Genoa', 'Palermo'],
  },
  {
    name: 'Switzerland', code: 'CH',
    cities: ['Zurich', 'Geneva', 'Basel', 'Bern', 'Lausanne', 'Lucerne', 'Lugano'],
  },
  {
    name: 'Sweden', code: 'SE',
    cities: ['Stockholm', 'Gothenburg', 'Malmö', 'Uppsala', 'Linköping'],
  },
  {
    name: 'Norway', code: 'NO',
    cities: ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'],
  },
  {
    name: 'Denmark', code: 'DK',
    cities: ['Copenhagen', 'Aarhus', 'Odense', 'Aalborg'],
  },
  {
    name: 'Finland', code: 'FI',
    cities: ['Helsinki', 'Espoo', 'Tampere', 'Turku', 'Oulu'],
  },
  {
    name: 'Ireland', code: 'IE',
    cities: ['Dublin', 'Cork', 'Galway', 'Limerick', 'Waterford'],
  },
  {
    name: 'Belgium', code: 'BE',
    cities: ['Brussels', 'Antwerp', 'Ghent', 'Bruges', 'Leuven', 'Liège'],
  },
  {
    name: 'Austria', code: 'AT',
    cities: ['Vienna', 'Graz', 'Linz', 'Salzburg', 'Innsbruck'],
  },
  {
    name: 'Poland', code: 'PL',
    cities: ['Warsaw', 'Kraków', 'Wrocław', 'Gdańsk', 'Poznań', 'Łódź', 'Katowice'],
  },
  {
    name: 'Czech Republic', code: 'CZ',
    cities: ['Prague', 'Brno', 'Ostrava', 'Plzeň'],
  },
  {
    name: 'Portugal', code: 'PT',
    cities: ['Lisbon', 'Porto', 'Braga', 'Coimbra', 'Faro'],
  },
  {
    name: 'Romania', code: 'RO',
    cities: ['Bucharest', 'Cluj-Napoca', 'Timișoara', 'Iași', 'Brașov'],
  },
  {
    name: 'Greece', code: 'GR',
    cities: ['Athens', 'Thessaloniki', 'Heraklion', 'Patras'],
  },
  {
    name: 'Turkey', code: 'TR',
    cities: ['Istanbul', 'Ankara', 'Izmir', 'Antalya', 'Bursa'],
  },
  {
    name: 'Israel', code: 'IL',
    cities: ['Tel Aviv', 'Jerusalem', 'Haifa', 'Herzliya', 'Ramat Gan', "Be'er Sheva"],
  },
  {
    name: 'United Arab Emirates', code: 'AE',
    cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
  },
  {
    name: 'Saudi Arabia', code: 'SA',
    cities: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina'],
  },
  {
    name: 'Japan', code: 'JP',
    cities: ['Tokyo', 'Osaka', 'Yokohama', 'Nagoya', 'Kyoto', 'Fukuoka', 'Sapporo', 'Kobe'],
  },
  {
    name: 'South Korea', code: 'KR',
    cities: ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon', 'Gwangju'],
  },
  {
    name: 'China', code: 'CN',
    cities: ['Beijing', 'Shanghai', 'Shenzhen', 'Guangzhou', 'Chengdu', 'Hangzhou', 'Nanjing', 'Wuhan', 'Suzhou', 'Tianjin'],
  },
  {
    name: 'Singapore', code: 'SG',
    cities: ['Singapore'],
  },
  {
    name: 'Hong Kong', code: 'HK',
    cities: ['Hong Kong'],
  },
  {
    name: 'Taiwan', code: 'TW',
    cities: ['Taipei', 'Kaohsiung', 'Taichung', 'Tainan', 'Hsinchu'],
  },
  {
    name: 'Philippines', code: 'PH',
    cities: ['Manila', 'Cebu City', 'Davao City', 'Quezon City', 'Makati'],
  },
  {
    name: 'Indonesia', code: 'ID',
    cities: ['Jakarta', 'Surabaya', 'Bandung', 'Bali', 'Medan'],
  },
  {
    name: 'Thailand', code: 'TH',
    cities: ['Bangkok', 'Chiang Mai', 'Phuket', 'Pattaya'],
  },
  {
    name: 'Vietnam', code: 'VN',
    cities: ['Ho Chi Minh City', 'Hanoi', 'Da Nang', 'Hai Phong'],
  },
  {
    name: 'Malaysia', code: 'MY',
    cities: ['Kuala Lumpur', 'Penang', 'Johor Bahru', 'Kuching', 'Kota Kinabalu'],
  },
  {
    name: 'New Zealand', code: 'NZ',
    cities: ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Queenstown'],
  },
  {
    name: 'South Africa', code: 'ZA',
    cities: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth'],
  },
  {
    name: 'Nigeria', code: 'NG',
    cities: ['Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan'],
  },
  {
    name: 'Kenya', code: 'KE',
    cities: ['Nairobi', 'Mombasa', 'Kisumu'],
  },
  {
    name: 'Egypt', code: 'EG',
    cities: ['Cairo', 'Alexandria', 'Giza'],
  },
  {
    name: 'Ghana', code: 'GH',
    cities: ['Accra', 'Kumasi', 'Tamale'],
  },
  {
    name: 'Argentina', code: 'AR',
    cities: ['Buenos Aires', 'Córdoba', 'Rosario', 'Mendoza'],
  },
  {
    name: 'Colombia', code: 'CO',
    cities: ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena'],
  },
  {
    name: 'Chile', code: 'CL',
    cities: ['Santiago', 'Valparaíso', 'Concepción', 'Viña del Mar'],
  },
  {
    name: 'Peru', code: 'PE',
    cities: ['Lima', 'Arequipa', 'Cusco', 'Trujillo'],
  },
  {
    name: 'Costa Rica', code: 'CR',
    cities: ['San José', 'Heredia', 'Alajuela'],
  },
  {
    name: 'Uruguay', code: 'UY',
    cities: ['Montevideo', 'Punta del Este'],
  },
  {
    name: 'Pakistan', code: 'PK',
    cities: ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad'],
  },
  {
    name: 'Bangladesh', code: 'BD',
    cities: ['Dhaka', 'Chittagong', 'Sylhet'],
  },
  {
    name: 'Russia', code: 'RU',
    cities: ['Moscow', 'Saint Petersburg', 'Novosibirsk', 'Yekaterinburg', 'Kazan'],
  },
  {
    name: 'Ukraine', code: 'UA',
    cities: ['Kyiv', 'Kharkiv', 'Odesa', 'Lviv', 'Dnipro'],
  },
  {
    name: 'Estonia', code: 'EE',
    cities: ['Tallinn', 'Tartu'],
  },
  {
    name: 'Latvia', code: 'LV',
    cities: ['Riga', 'Daugavpils'],
  },
  {
    name: 'Lithuania', code: 'LT',
    cities: ['Vilnius', 'Kaunas', 'Klaipėda'],
  },
  {
    name: 'Hungary', code: 'HU',
    cities: ['Budapest', 'Debrecen', 'Szeged'],
  },
  {
    name: 'Croatia', code: 'HR',
    cities: ['Zagreb', 'Split', 'Rijeka', 'Dubrovnik'],
  },
  {
    name: 'Serbia', code: 'RS',
    cities: ['Belgrade', 'Novi Sad', 'Niš'],
  },
  {
    name: 'Bulgaria', code: 'BG',
    cities: ['Sofia', 'Plovdiv', 'Varna'],
  },
  {
    name: 'Luxembourg', code: 'LU',
    cities: ['Luxembourg City'],
  },
  // ── Africa ──
  {
    name: 'Angola', code: 'AO',
    cities: ['Luanda', 'Huambo', 'Lobito', 'Benguela', 'Cabinda', 'Lubango', 'Malanje'],
  },
  {
    name: 'Algeria', code: 'DZ',
    cities: ['Algiers', 'Oran', 'Constantine', 'Annaba', 'Blida'],
  },
  {
    name: 'Cameroon', code: 'CM',
    cities: ['Douala', 'Yaoundé', 'Bamenda', 'Garoua', 'Bafoussam'],
  },
  {
    name: 'Côte d\'Ivoire', code: 'CI',
    cities: ['Abidjan', 'Yamoussoukro', 'Bouaké', 'San-Pédro'],
  },
  {
    name: 'Democratic Republic of the Congo', code: 'CD',
    cities: ['Kinshasa', 'Lubumbashi', 'Mbuji-Mayi', 'Kisangani', 'Goma'],
  },
  {
    name: 'Ethiopia', code: 'ET',
    cities: ['Addis Ababa', 'Dire Dawa', 'Mekelle', 'Adama', 'Hawassa'],
  },
  {
    name: 'Libya', code: 'LY',
    cities: ['Tripoli', 'Benghazi', 'Misrata'],
  },
  {
    name: 'Morocco', code: 'MA',
    cities: ['Casablanca', 'Rabat', 'Marrakech', 'Fez', 'Tangier', 'Agadir'],
  },
  {
    name: 'Mozambique', code: 'MZ',
    cities: ['Maputo', 'Beira', 'Nampula', 'Matola'],
  },
  {
    name: 'Rwanda', code: 'RW',
    cities: ['Kigali', 'Butare', 'Gisenyi'],
  },
  {
    name: 'Senegal', code: 'SN',
    cities: ['Dakar', 'Saint-Louis', 'Thiès', 'Touba'],
  },
  {
    name: 'Tanzania', code: 'TZ',
    cities: ['Dar es Salaam', 'Dodoma', 'Arusha', 'Mwanza', 'Zanzibar City'],
  },
  {
    name: 'Tunisia', code: 'TN',
    cities: ['Tunis', 'Sfax', 'Sousse', 'Kairouan'],
  },
  {
    name: 'Uganda', code: 'UG',
    cities: ['Kampala', 'Entebbe', 'Gulu', 'Jinja'],
  },
  {
    name: 'Zimbabwe', code: 'ZW',
    cities: ['Harare', 'Bulawayo', 'Mutare', 'Chitungwiza'],
  },
  {
    name: 'Botswana', code: 'BW',
    cities: ['Gaborone', 'Francistown', 'Maun'],
  },
  {
    name: 'Namibia', code: 'NA',
    cities: ['Windhoek', 'Walvis Bay', 'Swakopmund'],
  },
  {
    name: 'Zambia', code: 'ZM',
    cities: ['Lusaka', 'Kitwe', 'Ndola', 'Livingstone'],
  },
  {
    name: 'Madagascar', code: 'MG',
    cities: ['Antananarivo', 'Toamasina', 'Antsirabe'],
  },
  {
    name: 'Mauritius', code: 'MU',
    cities: ['Port Louis', 'Curepipe', 'Vacoas'],
  },
  // ── Middle East ──
  {
    name: 'Qatar', code: 'QA',
    cities: ['Doha', 'Al Wakrah', 'Al Khor'],
  },
  {
    name: 'Kuwait', code: 'KW',
    cities: ['Kuwait City', 'Hawalli', 'Salmiya'],
  },
  {
    name: 'Bahrain', code: 'BH',
    cities: ['Manama', 'Riffa', 'Muharraq'],
  },
  {
    name: 'Oman', code: 'OM',
    cities: ['Mascat', 'Salalah', 'Sohar'],
  },
  {
    name: 'Jordan', code: 'JO',
    cities: ['Amman', 'Irbid', 'Zarqa', 'Aqaba'],
  },
  {
    name: 'Lebanon', code: 'LB',
    cities: ['Beirut', 'Tripoli', 'Sidon', 'Jounieh'],
  },
  {
    name: 'Iraq', code: 'IQ',
    cities: ['Baghdad', 'Erbil', 'Basra', 'Sulaymaniyah'],
  },
  {
    name: 'Iran', code: 'IR',
    cities: ['Tehran', 'Isfahan', 'Tabriz', 'Shiraz', 'Mashhad'],
  },
  // ── Central Asia ──
  {
    name: 'Kazakhstan', code: 'KZ',
    cities: ['Almaty', 'Astana', 'Shymkent', 'Aktau'],
  },
  {
    name: 'Uzbekistan', code: 'UZ',
    cities: ['Tashkent', 'Samarkand', 'Bukhara', 'Namangan'],
  },
  {
    name: 'Georgia', code: 'GE',
    cities: ['Tbilisi', 'Batumi', 'Kutaisi'],
  },
  {
    name: 'Armenia', code: 'AM',
    cities: ['Yerevan', 'Gyumri', 'Vanadzor'],
  },
  {
    name: 'Azerbaijan', code: 'AZ',
    cities: ['Baku', 'Ganja', 'Sumqayit'],
  },
  // ── Southeast Asia & Pacific ──
  {
    name: 'Myanmar', code: 'MM',
    cities: ['Yangon', 'Mandalay', 'Naypyidaw'],
  },
  {
    name: 'Cambodia', code: 'KH',
    cities: ['Phnom Penh', 'Siem Reap', 'Battambang'],
  },
  {
    name: 'Laos', code: 'LA',
    cities: ['Vientiane', 'Luang Prabang'],
  },
  {
    name: 'Sri Lanka', code: 'LK',
    cities: ['Colombo', 'Kandy', 'Galle', 'Jaffna'],
  },
  {
    name: 'Nepal', code: 'NP',
    cities: ['Kathmandu', 'Pokhara', 'Lalitpur', 'Biratnagar'],
  },
  {
    name: 'Mongolia', code: 'MN',
    cities: ['Ulaanbaatar', 'Erdenet', 'Darkhan'],
  },
  {
    name: 'Fiji', code: 'FJ',
    cities: ['Suva', 'Nadi', 'Lautoka'],
  },
  {
    name: 'Papua New Guinea', code: 'PG',
    cities: ['Port Moresby', 'Lae', 'Mount Hagen'],
  },
  // ── Caribbean & Central America ──
  {
    name: 'Panama', code: 'PA',
    cities: ['Panama City', 'Colón', 'David'],
  },
  {
    name: 'Guatemala', code: 'GT',
    cities: ['Guatemala City', 'Quetzaltenango', 'Escuintla'],
  },
  {
    name: 'Honduras', code: 'HN',
    cities: ['Tegucigalpa', 'San Pedro Sula', 'La Ceiba'],
  },
  {
    name: 'El Salvador', code: 'SV',
    cities: ['San Salvador', 'Santa Ana', 'San Miguel'],
  },
  {
    name: 'Nicaragua', code: 'NI',
    cities: ['Managua', 'León', 'Granada'],
  },
  {
    name: 'Dominican Republic', code: 'DO',
    cities: ['Santo Domingo', 'Santiago', 'Punta Cana'],
  },
  {
    name: 'Jamaica', code: 'JM',
    cities: ['Kingston', 'Montego Bay', 'Spanish Town'],
  },
  {
    name: 'Trinidad and Tobago', code: 'TT',
    cities: ['Port of Spain', 'San Fernando', 'Chaguanas'],
  },
  {
    name: 'Puerto Rico', code: 'PR',
    cities: ['San Juan', 'Bayamón', 'Ponce', 'Carolina'],
  },
  {
    name: 'Cuba', code: 'CU',
    cities: ['Havana', 'Santiago de Cuba', 'Camagüey'],
  },
  // ── South America ──
  {
    name: 'Ecuador', code: 'EC',
    cities: ['Quito', 'Guayaquil', 'Cuenca', 'Manta'],
  },
  {
    name: 'Bolivia', code: 'BO',
    cities: ['La Paz', 'Santa Cruz', 'Cochabamba', 'Sucre'],
  },
  {
    name: 'Paraguay', code: 'PY',
    cities: ['Asunción', 'Ciudad del Este', 'Encarnación'],
  },
  {
    name: 'Venezuela', code: 'VE',
    cities: ['Caracas', 'Maracaibo', 'Valencia', 'Barquisimeto'],
  },
  // ── Europe ──
  {
    name: 'Slovakia', code: 'SK',
    cities: ['Bratislava', 'Košice', 'Prešov', 'Žilina'],
  },
  {
    name: 'Slovenia', code: 'SI',
    cities: ['Ljubljana', 'Maribor', 'Celje'],
  },
  {
    name: 'Bosnia and Herzegovina', code: 'BA',
    cities: ['Sarajevo', 'Banja Luka', 'Mostar', 'Tuzla'],
  },
  {
    name: 'North Macedonia', code: 'MK',
    cities: ['Skopje', 'Bitola', 'Ohrid'],
  },
  {
    name: 'Albania', code: 'AL',
    cities: ['Tirana', 'Durrës', 'Vlorë'],
  },
  {
    name: 'Montenegro', code: 'ME',
    cities: ['Podgorica', 'Budva', 'Nikšić'],
  },
  {
    name: 'Kosovo', code: 'XK',
    cities: ['Pristina', 'Prizren', 'Peja'],
  },
  {
    name: 'Moldova', code: 'MD',
    cities: ['Chișinău', 'Bălți', 'Tiraspol'],
  },
  {
    name: 'Belarus', code: 'BY',
    cities: ['Minsk', 'Gomel', 'Mogilev', 'Brest'],
  },
  {
    name: 'Iceland', code: 'IS',
    cities: ['Reykjavik', 'Akureyri', 'Kópavogur'],
  },
  {
    name: 'Malta', code: 'MT',
    cities: ['Valletta', 'Sliema', "St. Julian's", 'Birkirkara'],
  },
  {
    name: 'Cyprus', code: 'CY',
    cities: ['Nicosia', 'Limassol', 'Larnaca', 'Paphos'],
  },
];
// ── Searchable Dropdown ──
function SearchableDropdown({
  value,
  onChange,
  options,
  placeholder,
  icon: Icon,
  label,
  disabled,
  emptyMsg,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  icon: React.ElementType;
  label?: string;
  disabled?: boolean;
  emptyMsg?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [search, options]);

  const selectedLabel = options.find(o => o.value === value)?.label || '';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(!open); setSearch(''); }}
        className={`w-full flex items-center gap-2 pl-8 pr-8 py-2 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg transition-all text-left ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-zinc-500 cursor-pointer'
        } ${open ? 'ring-2 ring-[#1ED4A7]/30 border-[#1ED4A7]/50' : ''}`}
      >
        <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
        <span className={selectedLabel ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {value && !disabled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(''); }}
          className="absolute right-7 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors z-10"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl overflow-hidden">
          <div className="p-1.5 border-b border-zinc-200 dark:border-zinc-800">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('leadFinder.search', 'Search...')}
                className="w-full pl-6 pr-2 py-1.5 text-xs bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-zinc-500 text-center">{emptyMsg || t('leadFinder.noResults', 'No results')}</div>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); onChange(opt.value); setOpen(false); setSearch(''); }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${
                    value === opt.value ? 'text-[#1ED4A7] font-medium bg-[#1ED4A7]/5' : 'text-zinc-900 dark:text-zinc-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Multi-Select City Picker with free-text entry ──
function CityMultiSelect({
  selected,
  onChange,
  options,
  disabled,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  options: string[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(c => c.toLowerCase().includes(q));
  }, [search, options]);

  // Normalize a city name for display: title-case each word
  const normalizeCity = (raw: string): string => {
    return raw.trim().replace(/\s+/g, ' ').split(' ').map(w => {
      if (w.length <= 2 && w === w.toUpperCase()) return w; // keep abbreviations like "St."
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  };

  // Check if the search term matches an existing option (case-insensitive)
  const searchTrimmed = search.trim();
  const searchNormalized = normalizeCity(searchTrimmed);
  const isCustomCity = searchTrimmed.length >= 2 &&
    !options.some(o => o.toLowerCase() === searchTrimmed.toLowerCase()) &&
    !selected.some(s => s.toLowerCase() === searchTrimmed.toLowerCase());

  const addCustomCity = () => {
    if (searchNormalized && !selected.some(s => s.toLowerCase() === searchNormalized.toLowerCase())) {
      onChange([...selected, searchNormalized]);
      setSearch('');
    }
  };

  const toggle = (city: string) => {
    if (selected.includes(city)) {
      onChange(selected.filter(c => c !== city));
    } else {
      onChange([...selected, city]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isCustomCity) {
        addCustomCity();
      } else if (filtered.length === 1 && !selected.includes(filtered[0])) {
        // If exactly one match, select it
        toggle(filtered[0]);
        setSearch('');
      }
    }
    if (e.key === 'Backspace' && search === '' && selected.length > 0) {
      // Remove last selected city on backspace when input is empty
      onChange(selected.slice(0, -1));
    }
  };

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => { if (!disabled) { setOpen(true); setSearch(''); } }}
        className={`w-full flex items-center gap-2 pl-8 pr-8 py-2 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg transition-all text-left min-h-[38px] ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-zinc-500 cursor-pointer'
        } ${open ? 'ring-2 ring-[#1ED4A7]/30 border-[#1ED4A7]/50' : ''}`}
      >
        <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
        {selected.length > 0 ? (
          <span className="text-zinc-900 dark:text-zinc-100 truncate">
            {selected.length <= 3 ? selected.join(', ') : `${selected.slice(0, 2).join(', ')} +${selected.length - 2}`}
          </span>
        ) : (
          <span className="text-zinc-400">{t('leadFinder.typeSelectCities', 'Type or select cities...')}</span>
        )}
        <ChevronDown className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {selected.length > 0 && !disabled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange([]); }}
          className="absolute right-7 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors z-10"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl overflow-hidden">
          <div className="p-1.5 border-b border-zinc-200 dark:border-zinc-800">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('leadFinder.typeAnyCity', 'Type any city name...')}
                className="w-full pl-6 pr-2 py-1.5 text-xs bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>
          {selected.length > 0 && (
            <div className="px-2 py-1.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-1">
              {selected.map(city => (
                <span
                  key={city}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-[#1ED4A7]/10 text-[#1ED4A7] rounded-full"
                >
                  {city}
                  <button type="button" onClick={() => toggle(city)} className="hover:text-white transition-colors">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="max-h-52 overflow-y-auto">
            {/* Custom city add option — shown when typed city doesn't match existing options */}
            {isCustomCity && (
              <button
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  addCustomCity();
                }}
                className="w-full text-left px-3 py-2.5 text-xs hover:bg-[#1ED4A7]/10 transition-colors flex items-center gap-2 text-[#1ED4A7] font-medium border-b border-zinc-200 dark:border-zinc-800"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('leadFinder.addCity', 'Add')} "{searchNormalized}"
              </button>
            )}
            {filtered.length === 0 && !isCustomCity ? (
              <div className="px-3 py-3 text-xs text-zinc-500 text-center">
                {t('leadFinder.typeCityHint', 'Type a city name and press Enter to add it')}
              </div>
            ) : (
              <>
                {filtered.length > 0 && searchTrimmed.length > 0 && (
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    {t('leadFinder.suggestions', 'Suggestions')}
                  </div>
                )}
                {filtered.map(city => (
                  <button
                    key={city}
                    type="button"
                    onMouseDown={e => {
                      e.preventDefault();
                      toggle(city);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2 ${
                      selected.includes(city) ? 'text-[#1ED4A7] font-medium bg-[#1ED4A7]/5' : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                      selected.includes(city) ? 'bg-[#1ED4A7] border-[#1ED4A7]' : 'border-zinc-500'
                    }`}>
                      {selected.includes(city) && <span className="text-zinc-900 text-[8px] font-bold">✓</span>}
                    </div>
                    {city}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main LocationPicker ──

export interface LocationPickerValue {
  country: string;
  state: string;
  cities: string[];
}

export function LocationPicker({
  value,
  onChange,
}: {
  value: LocationPickerValue;
  onChange: (v: LocationPickerValue) => void;
}) {
  const { t } = useTranslation();
  
  const countryData = useMemo(
    () => COUNTRIES.find(c => c.name === value.country),
    [value.country]
  );

  const hasStates = countryData?.hasStates && countryData.states && countryData.states.length > 0;

  const stateData = useMemo(() => {
    if (!hasStates || !value.state) return null;
    return countryData?.states?.find(s => s.name === value.state) || null;
  }, [countryData, value.state, hasStates]);

  // Get available cities based on selected country + state
  const availableCities = useMemo(() => {
    if (!countryData) return [];
    if (hasStates) {
      if (value.state && stateData) {
        return stateData.cities;
      }
      // If no state selected, show all cities from all states
      return countryData.states?.flatMap(s => s.cities) || [];
    }
    return countryData.cities || [];
  }, [countryData, hasStates, value.state, stateData]);

  const countryOptions = useMemo(
    () => COUNTRIES.map(c => ({ value: c.name, label: c.name })),
    []
  );

  const stateOptions = useMemo(() => {
    if (!countryData?.states) return [];
    return countryData.states.map(s => ({ value: s.name, label: s.name }));
  }, [countryData]);

  return (
    <div className="space-y-3">
      {/* Country */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          {t('leadFinder.country', 'Country')}
        </label>
        <SearchableDropdown
          value={value.country}
          onChange={country => onChange({ country, state: '', cities: [] })}
          options={countryOptions}
          placeholder={t('leadFinder.selectCountry', 'Select country...')}
          icon={Globe}
        />
      </div>

      {/* State/Region — only for countries with states */}
      {hasStates && (
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
            {value.country === 'United States' ? t('leadFinder.state', 'State') :
             value.country === 'Canada' ? t('leadFinder.province', 'Province') :
             value.country === 'United Kingdom' ? t('leadFinder.region', 'Region') :
             value.country === 'Australia' ? t('leadFinder.stateTerritory', 'State/Territory') :
             value.country === 'Germany' ? t('leadFinder.state', 'State') :
             value.country === 'India' ? t('leadFinder.state', 'State') :
             value.country === 'Brazil' ? t('leadFinder.state', 'State') :
             t('leadFinder.region', 'Region')}
            <span className="text-zinc-400 normal-case ml-1">{t('leadFinder.optional', '(optional)')}</span>
          </label>
          <SearchableDropdown
            value={value.state}
            onChange={state => onChange({ ...value, state, cities: [] })}
            options={stateOptions}
            placeholder={value.country === 'Canada' ? t('leadFinder.allProvinces', 'All provinces...') : t('leadFinder.allStates', 'All states...')}
            icon={MapPin}
            disabled={!value.country}
          />
        </div>
      )}

      {/* City — multi-select */}
      {value.country && (
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
            {t('leadFinder.city', 'City')}
            <span className="text-zinc-400 normal-case ml-1">{t('leadFinder.citySub', '(type any city or select from list)')}</span>
          </label>
          <CityMultiSelect
            selected={value.cities}
            onChange={cities => onChange({ ...value, cities })}
            options={availableCities}
            disabled={!value.country}
          />
        </div>
      )}
    </div>
  );
}

// ── Utility: Convert LocationPickerValue → API location strings ──
export function buildLocationStrings(loc: LocationPickerValue): string[] {
  if (!loc.country) return [];

  if (loc.cities.length > 0) {
    // Build "City, State, Country" strings
    return loc.cities.map(city => {
      const parts = [city];
      if (loc.state) parts.push(loc.state);
      parts.push(loc.country);
      return parts.join(', ');
    });
  }

  if (loc.state) {
    return [`${loc.state}, ${loc.country}`];
  }

  return [loc.country];
}