import { useState, useEffect, useMemo, useRef } from "react";
import {
  isSupabaseConfigured,
  supabase,
  ensureSupabaseSession,
  fetchPredictionsRow,
  fetchAllPredictions,
  upsertPredictions,
  upsertProfile,
  fetchProfile,
  createCheckoutSession,
  checkPaymentStatus,
  sendEmail,
  signUpWithPassword,
  signInWithPassword,
  requestPasswordReset,
  ensureProfileFromAuthSession,
} from "./lib/supabase";
import { isApiFootballConfigured, fetchAllResults, hasLiveMatches, getMatchResultForTeams } from "./lib/api-football";
import { getSubmissionDeadlineMs, getFirstKickoffMs, formatCountdown, formatDeadlineLocal } from "./lib/tournament-deadline";
import { scorePredictions, scoreMatch } from "./lib/scoring";

const STORAGE_KEY = "wc-predictions-2026";
const ENTRY_FEE_GBP = 10;
const COST_PERCENT = Math.min(
  100,
  Math.max(0, Number(import.meta.env.VITE_COST_PERCENT || 0)),
);

function getPotBreakdown(entryCount) {
  const grossPot = entryCount * ENTRY_FEE_GBP;
  const costAmount = grossPot * (COST_PERCENT / 100);
  const prizePot = Math.max(0, grossPot - costAmount);
  return { grossPot, costAmount, prizePot };
}

// Finalised 2026 World Cup groups — all 48 teams confirmed after March 2026 playoffs
// UEFA PO-A=Bosnia-Herzegovina, PO-B=Sweden, PO-C=Turkey, PO-D=Czech Republic
// IC PO-1=DR Congo, IC PO-2=Iraq
const TEAMS = {
  A: ["Mexico","South Africa","South Korea","Czech Republic"],
  B: ["Canada","Bosnia-Herzegovina","Qatar","Switzerland"],
  C: ["Brazil","Morocco","Haiti","Scotland"],
  D: ["USA","Paraguay","Australia","Turkey"],
  E: ["Germany","Curaçao","Ivory Coast","Ecuador"],
  F: ["Netherlands","Japan","Sweden","Tunisia"],
  G: ["Belgium","Egypt","Iran","New Zealand"],
  H: ["Spain","Cape Verde","Saudi Arabia","Uruguay"],
  I: ["France","Senegal","Iraq","Norway"],
  J: ["Argentina","Algeria","Austria","Jordan"],
  K: ["Portugal","DR Congo","Uzbekistan","Colombia"],
  L: ["England","Croatia","Ghana","Panama"],
};

/** ISO 3166-1 alpha-2 or flag-icons regional codes (e.g. gb-eng) for SVG flags. */
const TEAM_FLAG_CODE = {
  Mexico: "mx",
  "South Africa": "za",
  "South Korea": "kr",
  "Czech Republic": "cz",
  Canada: "ca",
  "Bosnia-Herzegovina": "ba",
  Qatar: "qa",
  Switzerland: "ch",
  Brazil: "br",
  Morocco: "ma",
  Haiti: "ht",
  Scotland: "gb-sct",
  USA: "us",
  Paraguay: "py",
  Australia: "au",
  Turkey: "tr",
  Germany: "de",
  Curaçao: "cw",
  "Ivory Coast": "ci",
  Ecuador: "ec",
  Netherlands: "nl",
  Japan: "jp",
  Sweden: "se",
  Tunisia: "tn",
  Belgium: "be",
  Egypt: "eg",
  Iran: "ir",
  "New Zealand": "nz",
  Spain: "es",
  "Cape Verde": "cv",
  "Saudi Arabia": "sa",
  Uruguay: "uy",
  France: "fr",
  Senegal: "sn",
  Iraq: "iq",
  Norway: "no",
  Argentina: "ar",
  Algeria: "dz",
  Austria: "at",
  Jordan: "jo",
  Portugal: "pt",
  "DR Congo": "cd",
  Uzbekistan: "uz",
  Colombia: "co",
  England: "gb-eng",
  Croatia: "hr",
  Ghana: "gh",
  Panama: "pa",
};

const FLAG_ICONS_VER = "7.2.3";

function TeamFlag({ team, className = "", size = 24 }) {
  const code = TEAM_FLAG_CODE[team];
  const h = Math.round((size * 3) / 4);
  if (!code) {
    return (
      <span className={`flag-placeholder ${className}`} style={{ fontSize: Math.max(14, size * 0.75), lineHeight: 1 }} role="img" aria-hidden>
        🏳
      </span>
    );
  }
  const src = `https://cdn.jsdelivr.net/gh/lipis/flag-icons@${FLAG_ICONS_VER}/flags/4x3/${code}.svg`;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={h}
      className={`flag-img ${className}`}
      loading="lazy"
      decoding="async"
    />
  );
}

// 2026 WC squads — forwards & attacking mids prioritised for scorer predictions
const PLAYERS = {
  "Mexico": ["Santiago Giménez","Hirving Lozano","Alexis Vega","Raúl Jiménez","Henry Martín","Roberto Alvarado","Uriel Antuna","César Huerta","Julián Quiñones","Diego Laínez","Orbelin Pineda","Luis Chávez","Edson Álvarez","Luis Romo","Johan Vásquez"],
  "South Africa": ["Lyle Foster","Percy Tau","Evidence Makgopa","Iqraam Rayners","Bongokuhle Hlongwane","Teboho Mokoena","Themba Zwane","Oswin Appollis","Relebohile Mofokeng","Elias Mokwana","Aubrey Modiba","Thabiso Kutumela","Ethan Brooks","Sphephelo Sithole","Thapelo Morena"],
  "South Korea": ["Son Heung-min","Lee Kang-in","Hwang Hee-chan","Oh Hyeon-gyu","Cho Gue-sung","Bae Jun-ho","Hwang In-beom","Jeong Woo-yeong","Lee Jae-sung","Yang Hyun-jun","Song Min-kyu","Um Won-sang","Seol Young-woo","Park Jin-seop","Kwon Chang-hoon"],
  "Czech Republic": ["Patrik Schick","Adam Hlozek","Tomáš Souček","Lukáš Provod","Jan Kuchta","Alex Král","Mojmír Chytil","Pavel Šulc","Adam Karabec","Ondřej Lingr","Václav Jurečka","Jakub Pešek","Vladimír Coufal","David Jurásek","Jiří Jirásek"],
  "Canada": ["Jonathan David","Alphonso Davies","Cyle Larin","Tajon Buchanan","Ismaël Koné","Liam Millar","Jonathan Osorio","Stephen Eustáquio","Jacob Shaffelburg","Jacen Russell-Rowe","Alistair Johnston","Ali Ahmed","Theo Corbeanu","Junior Hoilett","Moise Bombito"],
  "Bosnia-Herzegovina": ["Ermedin Demirovic","Benjamin Tahirović","Amer Gojak","Haris Hajradinović","Luka Menalo","Armin Hodžić","Veldin Muharemovic","Smail Prevljak","Aldin Turković","Denis Huseinbašić","Džemal Šabović","Lazar Vušković","Mersud Ahmetovic","Nikola Krstović","Edin Džeko"],
  "Qatar": ["Akram Afif","Almoez Ali","Mohammed Muntari","Abdulaziz Hatem","Hassan Al-Haydos","Hisham Asaad","Bassam Al-Rawi","Ahmed Alaaeldin","Yusuf Abdurisag","Boualem Khoukhi","Assim Madibo","Abdullah Al-Ahrak","Ismaeel Mohammad","Karim Boudiaf","Ali Asad"],
  "Switzerland": ["Breel Embolo","Noah Okafor","Dan Ndoye","Zeki Amdouni","Ruben Vargas","Fabian Rieder","Granit Xhaka","Remo Freuler","Djibril Sow","Kwadwo Duah","Vincent Sierro","Andi Zeqiri","Xherdan Shaqiri","Renato Steffen","Manuel Akanji"],
  "Brazil": ["Vinicius Jr","Rodrygo","Raphinha","Endrick","Estêvão","Savinho","Gabriel Martinelli","Lucas Paquetá","Bruno Guimarães","Gabriel Jesus","Igor Jesus","Pedro","Luiz Henrique","João Pedro","Marquinhos"],
  "Morocco": ["Youssef En-Nesyri","Hakim Ziyech","Achraf Hakimi","Brahim Díaz","Azzedine Ounahi","Abde Ezzalzouli","Soufiane Rahimi","Bilal El Khannouss","Zakaria Aboukhlal","Ilias Chair","Sofiane Boufal","Noussair Mazraoui","Amine Adli","Sofyan Amrabat","Munir El Haddadi"],
  "Haiti": ["Frantzdy Pierrot","Duckens Nazon","Derrick Etienne Jr","Bryan Alcéus","Steeven Saba","Leverton Pierre","Richardo Thomas","Josué Duverger","Jeff Louis","Wilde-Donald Guerrier","Carlton Ulengo","Ricardo Ade","Danley Jean Jacques","Mechack Jérôme","Andy Nado"],
  "Scotland": ["Scott McTominay","Che Adams","Lawrence Shankland","John McGinn","Andy Robertson","Ryan Christie","Ben Doak","Lewis Ferguson","Tommy Conway","Billy Gilmour","Stuart Armstrong","Kenny McLean","James Forrest","Lyndon Dykes","Ryan Jack"],
  "USA": ["Christian Pulisic","Gio Reyna","Ricardo Pepi","Folarin Balogun","Tim Weah","Josh Sargent","Weston McKennie","Yunus Musah","Tyler Adams","Brenden Aaronson","Haji Wright","Malik Tillman","Cade Cowell","Brandon Vazquez","Sergiño Dest"],
  "Paraguay": ["Miguel Almirón","Julio Enciso","Antonio Sanabria","Ramón Sosa","Alejandro Romero Gamarra","Ángel Romero","Adam Bareiro","Óscar Romero","Mathías Villasanti","Richard Sánchez","Gabriel Avalos","Gustavo Gómez","Iván Villalba","Derlis González","Hugo Millán"],
  "Australia": ["Craig Goodwin","Garang Kuol","Nestory Irankunda","Mitchell Duke","Martin Boyle","Riley McGree","Jackson Irvine","Ajdin Hrustic","Marco Tilio","Keanu Baccus","Kusini Yengi","Adam Taggart","Connor Metcalfe","Awer Mabil","Mathew Leckie"],
  "Turkey": ["Arda Güler","Hakan Çalhanoğlu","Kerem Aktürkoğlu","Barış Alper Yılmaz","Ferdi Kadıoğlu","Orkun Kökçü","Okay Yokuşlu","Cengiz Ünder","Semih Kılıçsoy","Bertuğ Yıldırım","Salih Özcan","Mert Müldür","Ozan Kabak","Zeki Çelik","Kenan Karaman"],
  "Germany": ["Florian Wirtz","Jamal Musiala","Kai Havertz","Leroy Sané","Niclas Füllkrug","Serge Gnabry","Deniz Undav","Maximilian Beier","Chris Führich","Tim Kleindienst","Joshua Kimmich","İlkay Gündoğan","Robert Andrich","Felix Nmecha","Youssoufa Moukoko"],
  "Curaçao": ["Leandro Bacuna","Rangelo Janga","Kenji Gorré","Elson Hooi","Jurien Gaari","Juninho Bacuna","Charlton Vicento","Giliano Wijnaldum","Gervane Kastaneer","Jarchinio Antonia","Vurnon Anita","Cuco Martina","Shermaine Martina","Ruven Providence","Darryl Lachman"],
  "Ivory Coast": ["Sébastien Haller","Simon Adingra","Nicolas Pépé","Oumar Diakité","Christian Kouamé","Franck Kessié","Ibrahim Sangaré","Maxwel Cornet","Hamed Traoré","Jérémy Boga","Wilfried Zaha","Jonathan Bamba","Odilon Kossounou","Jean-Philippe Gbamin","Serge Aurier"],
  "Ecuador": ["Kendry Páez","Enner Valencia","Moisés Caicedo","Gonzalo Plata","Jeremy Sarmiento","Djorkaeff Reasco","Kevin Rodríguez","John Yeboah","Alan Minda","Michael Estrada","Ángel Mena","Pervis Estupiñán","Joao Rojas","William Pacho","Fidel Martínez"],
  "Netherlands": ["Cody Gakpo","Xavi Simons","Memphis Depay","Donyell Malen","Brian Brobbey","Joshua Zirkzee","Wout Weghorst","Frenkie de Jong","Tijjani Reijnders","Ryan Gravenberch","Jeremie Frimpong","Steven Bergwijn","Denzel Dumfries","Virgil van Dijk","Jurriën Timber"],
  "Japan": ["Takefusa Kubo","Kaoru Mitoma","Ritsu Doan","Ayase Ueda","Kyogo Furuhashi","Takumi Minamino","Daichi Kamada","Junya Ito","Ao Tanaka","Keito Nakamura","Koji Miyoshi","Wataru Endo","Hidemasa Morita","Reo Hatate","Takehiro Tomiyasu"],
  "Sweden": ["Alexander Isak","Viktor Gyökeres","Dejan Kulusevski","Anthony Elanga","Emil Forsberg","Mattias Svanberg","Jesper Karlsson","Victor Claesson","Jordan Larsson","Robin Quaison","Joakim Nilsson","Pontus Jansson","Ludvig Augustinsson","Marcus Danielson","Marcus Pedersen"],
  "Tunisia": ["Anis Ben Slimane","Hannibal Mejbri","Youssef Msakni","Ellyes Skhiri","Seifeddine Jaziri","Issam Jebali","Wahbi Khazri","Mohamed Drager","Ferjani Sassi","Naim Sliti","Ali Abdi","Hamza Rafia","Montassar Talbi","Ala Ghram","Saad Bguir"],
  "Belgium": ["Kevin De Bruyne","Romelu Lukaku","Lois Openda","Jeremy Doku","Leandro Trossard","Charles De Ketelaere","Johan Bakayoko","Julien Duranville","Amadou Onana","Yannick Carrasco","Youri Tielemans","Dries Mertens","Arthur Vermeeren","Michy Batshuayi","Hans Vanaken"],
  "Egypt": ["Mohamed Salah","Omar Marmoush","Mostafa Mohamed","Trezeguet","Ahmed Hassan Kouka","Emam Ashour","Ibrahim Adel","Ahmed Sayed Zizou","Mohamed Elneny","Akram Tawfik","Marwan Hamdi","Hussein El Shahat","Amr El-Sulaya","Karim Fouad","Mahmoud Trezeguet"],
  "Iran": ["Mehdi Taremi","Sardar Azmoun","Alireza Jahanbakhsh","Saman Ghoddos","Ali Gholizadeh","Shahab Zahedi","Karim Ansarifard","Ahmad Noorollahi","Saeid Ezatolahi","Milad Mohammadi","Ehsan Hajsafi","Allahyar Sayyadmanesh","Omid Noorafkan","Shoja Khalilzadeh","Reza Shekari"],
  "New Zealand": ["Chris Wood","Matt Garbett","Liberato Cacace","Marco Rojas","Elijah Just","Ben Waine","Joe Bell","Marko Stamenic","Clayton Lewis","Alex Greive","Sarpreet Singh","Tim Payne","Nando Pijnaker","Tommy Smith","Michael Woud"],
  "Spain": ["Lamine Yamal","Pedri","Nicolás Williams","Dani Olmo","Álvaro Morata","Ferran Torres","Gavi","Mikel Oyarzabal","Fabian Ruiz","Rodri","Mikel Merino","Joselu","Ayoze Pérez","Alejandro Baena","Pau Cubarsí"],
  "Cape Verde": ["Ryan Mendes","Garry Rodrigues","Jamiro Monteiro","Kenny Rocha Santos","Julio Tavares","Stopira","Dylan Tavares","Lisandro Semedo","Jovane Cabral","Willy Semedo","Roberto Lopes","Nuno Borges","Gilson Benchimol","Steven Fortes","Patrick Andrade"],
  "Saudi Arabia": ["Salem Al-Dawsari","Firas Al-Buraikan","Saleh Al-Shehri","Mohammed Al-Dawsari","Sami Al-Najei","Abdullah Al-Hamdan","Abdulrahman Ghareeb","Hattan Bahebri","Ali Al-Bulayhi","Mohammed Al-Breik","Yasser Al-Shahrani","Nasser Al-Dawsari","Ayman Yahya","Mohammed Kanno","Hassan Kadesh"],
  "Uruguay": ["Darwin Núñez","Federico Valverde","Facundo Torres","Nicolás de la Cruz","Rodrigo Bentancur","Mathías Olivera","Agustín Canobbio","Maximiliano Araújo","Luciano Rodríguez","Facundo Pellistri","Ronald Araújo","José María Giménez","Manuel Ugarte","Giorgian De Arrascaeta","Agustín Álvarez Martínez"],
  "France": ["Kylian Mbappé","Marcus Thuram","Ousmane Dembélé","Antoine Griezmann","Randal Kolo Muani","Bradley Barcola","Eduardo Camavinga","Aurélien Tchouaméni","Warren Zaïre-Emery","Kingsley Coman","Christopher Nkunku","Michael Olise","William Saliba","Adrien Rabiot","Désiré Doué"],
  "Senegal": ["Nicolas Jackson","Sadio Mané","Ismaïla Sarr","Iliman Ndiaye","Boulaye Dia","Habib Diarra","Pape Matar Sarr","Idrissa Gueye","Krepin Diatta","Kalidou Koulibaly","Lamine Camara","Abdallah Sima","Cheikhou Kouyaté","Nampalys Mendy","Abdoulaye Seck"],
  "Iraq": ["Mohanad Ali","Amjad Attwan","Bashar Resan","Humam Tariq","Ali Adnan","Ahmed Ibrahim","Hussein Ali","Aihem Auda","Ameen Mohammed","Osama Rashid","Mustafa Nadhim","Saad Abdulamir","Hasan Abdulkareem","Yousif Abed","Ahmed Yasin"],
  "Norway": ["Erling Haaland","Martin Ødegaard","Alexander Sørloth","Antonio Nusa","Oscar Bobb","Sander Berge","Kristian Thorstvedt","Fredrik Aursnes","Jens Petter Hauge","Mohamed Elyounoussi","Patrick Berg","Ola Solbakken","Mats Møller Dæhli","Birger Meling","David Møller Wolfe"],
  "Argentina": ["Lionel Messi","Julián Álvarez","Lautaro Martínez","Alejandro Garnacho","Rodrigo De Paul","Alexis Mac Allister","Paulo Dybala","Nicolás González","Enzo Fernández","Giovani Lo Celso","Thiago Almada","Leandro Paredes","Ángel Correa","Valentín Castellanos","Valentín Barco"],
  "Algeria": ["Riyad Mahrez","Ismaël Bennacer","Amine Gouiri","Mohamed Amoura","Youcef Atal","Houssem Aouar","Aissa Mandi","Sofiane Feghouli","Baghdad Bounedjah","Said Benrahma","Adam Zorgane","Andy Delort","Yacine Brahimi","Ramy Bensebaini","Farès Chaïbi"],
  "Austria": ["Marcel Sabitzer","Christoph Baumgartner","Marko Arnautovic","Michael Gregoritsch","Patrick Wimmer","Konrad Laimer","Nicolas Seiwald","Florian Grillitsch","Alexander Prass","Kevin Danso","Maximilian Entrup","Romano Schmid","Phillipp Mwene","Flavius Daniliuc","Matthias Seidl"],
  "Jordan": ["Musa Al-Taamari","Yazan Al-Naimat","Hamza Al-Dardour","Baha' Faisal","Yazan Al-Arab","Mousa Tamari","Ahmad Saleh","Nour El-Rawabdeh","Al-Motaz Abdallah","Mohammad Abu Zema","Abdullah Nasib","Yousef Al-Rawashdeh","Salem Al-Ajalin","Ehsan Haddad","Mohammad Rashdan"],
  "Portugal": ["Cristiano Ronaldo","Bruno Fernandes","Rafael Leão","Bernardo Silva","Diogo Jota","Gonçalo Ramos","Pedro Neto","João Félix","Vitinha","Francisco Conceição","João Neves","Rúben Neves","Florentino Luís","António Silva","Nuno Mendes"],
  "DR Congo": ["Dodi Lukebakio","Jackson Muleka","Théo Bongonda","Chancel Mbemba","Arthur Masuaku","Neeskens Kebano","Samuel Bastien","Merveille Bope","Jonathan Bolingi","Cédric Bakambu","Chadrac Akolo","Jean-Marc Makusu","Silas Nsimba","Glody Likonza","Emmanuel Leko"],
  "Uzbekistan": ["Eldor Shomurodov","Abbosbek Fayzullaev","Jaloliddin Masharipov","Dostonbek Khamdamov","Otabek Shukurov","Khojimat Erkinov","Bobur Abdixoliqov","Oston Urunov","Islom Tukhtakhodjaev","Odiljon Hamrobekov","Husniddin Aliqulov","Azizbek Turgunboev","Jasurbek Yakhshiboev","Khurshid Tursunov","Abdurauf Buriev"],
  "Colombia": ["Luis Díaz","Jhon Durán","Rafael Santos Borré","James Rodríguez","Richard Ríos","Jhon Arias","Jorge Carrascal","Juan Quintero","Juan Cuadrado","Yaser Asprilla","Miguel Borja","Mateus Uribe","Jefferson Lerma","Luis Sinisterra","Daniel Muñoz"],
  "England": ["Harry Kane","Jude Bellingham","Bukayo Saka","Phil Foden","Cole Palmer","Ollie Watkins","Anthony Gordon","Eberechi Eze","Declan Rice","Trent Alexander-Arnold","Marcus Rashford","Jarrod Bowen","Morgan Gibbs-White","Kobbie Mainoo","Levi Colwill"],
  "Croatia": ["Luka Modrić","Andrej Kramarić","Mateo Kovačić","Mario Pašalić","Lovro Majer","Ante Budimir","Luka Sučić","Martin Baturina","Josip Stanišić","Mislav Oršić","Bruno Petković","Nikola Vlašić","Igor Matanović","Joško Gvardiol","Ivan Perišić"],
  "Ghana": ["Mohammed Kudus","Inaki Williams","Jordan Ayew","Antoine Semenyo","Ernest Nuamah","Thomas Partey","Osman Bukari","Ibrahim Sadiq","Abdul Fatawu Issahaku","Kamaldeen Sulemana","Mohammed Salisu","Daniel-Kofi Kyereh","Elisha Owusu","Alexander Djiku","Tariqe Fosu-Henry"],
  "Panama": ["José Fajardo","Ismael Díaz","César Yanis","Adalberto Carrasquilla","Édgar Bárcenas","Andrés Andrade","Freddy Góndola","Eric Davis","Michael Amir Murillo","Rolando Blackburn","Gabriel Torres","Alberto Quintero","Abdiel Ayarza","Omar Browne","José Luis Rodríguez"],
};

const ALL_TEAMS = Object.values(TEAMS).flat();

const GROUP_MATCHES = Object.entries(TEAMS).flatMap(([group, teams]) => [
  { group, home: teams[0], away: teams[1] },
  { group, home: teams[2], away: teams[3] },
  { group, home: teams[0], away: teams[2] },
  { group, home: teams[1], away: teams[3] },
  { group, home: teams[0], away: teams[3] },
  { group, home: teams[1], away: teams[2] },
]);

/** Values must match api-football mapRoundToEnglandProgress() for live scoring. */
const ENGLAND_PROGRESS_OPTIONS = [
  { value: "Group stage", label: "Group stage only" },
  { value: "Round of 32", label: "Round of 32" },
  { value: "Round of 16", label: "Round of 16" },
  { value: "Quarter-finals", label: "Quarter-finals" },
  { value: "Semi-finals", label: "Semi-finals" },
  { value: "Final", label: "Final (lose final)" },
  { value: "Winners", label: "Winners" },
];

const COLORS = {
  primary: "#0a0a0a",
  accent: "#C9A84C",
  gold: "#C9A84C",
  goldLight: "#E8C96A",
  goldDark: "#9A7A2E",
  green: "#4CAF50",
  blue: "#1565C0",
  card: "#111111",
  cardLight: "#1a1a1a",
  border: "#2a2a2a",
  textMuted: "#888888",
};



const css = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Barlow:wght@400;500;600;700&family=Noto+Sans:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
  body { font-family: 'Noto Sans', sans-serif; background: #000; color: #fff; min-height: 100vh; -webkit-tap-highlight-color: transparent; }
  *:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }
  input:focus-visible, select:focus-visible { outline-offset: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
  .app { max-width: 900px; margin: 0 auto; padding: 0 0 80px; padding-bottom: max(80px, calc(60px + env(safe-area-inset-bottom, 0px))); }

  .hero { background: #000; padding: 0; border-bottom: 1px solid #222; position: relative; overflow: hidden; }
  .hero-pattern { position: absolute; inset: 0; opacity: 0.04; background-image: repeating-linear-gradient(0deg, transparent, transparent 38px, #fff 38px, #fff 39px), repeating-linear-gradient(90deg, transparent, transparent 38px, #fff 38px, #fff 39px); }
  .hero-inner { position: relative; padding: 2rem 1.5rem 1.5rem; text-align: center; }
  .hero-eyebrow { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 0.72rem; letter-spacing: 4px; text-transform: uppercase; color: #555; margin-bottom: 8px; }
  .hero-26 { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 7rem; line-height: 0.85; color: #fff; letter-spacing: -4px; position: relative; display: inline-block; }
  .hero-26 span { display: block; }
  .hero-26-gold { color: ${COLORS.gold}; }
  .hero-title-row { margin-top: 12px; }
  .hero-weare { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.6rem; letter-spacing: 2px; text-transform: uppercase; color: #fff; }
  .hero-weare em { color: ${COLORS.gold}; font-style: normal; }
  .hero-tags { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .hero-tag { font-family: 'Barlow', sans-serif; font-size: 0.72rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #666; border: 1px solid #2a2a2a; border-radius: 3px; padding: 4px 10px; }
  .hero-divider { height: 3px; background: ${COLORS.gold}; }

  .nav { display: flex; align-items: stretch; gap: 0; background: #0a0a0a; border-bottom: 1px solid #1e1e1e; position: sticky; top: 0; z-index: 10; overflow: visible; }
  .nav-tabs-scroll { display: flex; flex: 1; min-width: 0; overflow-x: auto; gap: 0; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none; }
  .nav-tabs-scroll::-webkit-scrollbar { display: none; }
  .nav-btn { flex-shrink: 0; padding: 13px 18px; font-family: 'Barlow Condensed', sans-serif; font-size: 0.85rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; background: none; border: none; color: #555; cursor: pointer; white-space: nowrap; border-bottom: 3px solid transparent; transition: all 0.2s; min-height: 48px; display: flex; align-items: center; }
  .nav-btn.active { color: ${COLORS.gold}; border-bottom-color: ${COLORS.gold}; }
  .nav-btn:hover:not(.active) { color: #ccc; }
  /* Outside the scrolling tab strip so it is always visible on narrow screens */
  .nav-signout {
    flex-shrink: 0;
    min-height: 48px;
    padding: 13px 14px 13px 16px;
    font-family: 'Barlow', sans-serif;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.5px;
    background: #0a0a0a;
    border: none;
    border-left: 1px solid #252525;
    box-shadow: -10px 0 14px -6px rgba(0,0,0,0.75);
    color: #a8a8a8;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.2s, background 0.2s;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .nav-signout:hover { color: #ff6b6b; background: #111; }
  .nav-signout:focus-visible { outline-offset: -2px; }

  .section { padding: 1.5rem; }
  .section-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.8rem; letter-spacing: 1px; text-transform: uppercase; color: #fff; margin-bottom: 2px; }
  .section-title-line { width: 36px; height: 3px; background: ${COLORS.gold}; margin-bottom: 10px; }
  .section-sub { font-size: 0.82rem; color: #666; margin-bottom: 1.2rem; font-family: 'Noto Sans', sans-serif; }

  .card-header { background: #111; padding: 8px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e1e1e; }
  .group-badge { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 0.85rem; letter-spacing: 2px; text-transform: uppercase; color: ${COLORS.gold}; }
  .match-row { padding: 14px; }
  .flag-img { object-fit: cover; border-radius: 2px; box-shadow: 0 0 0 1px rgba(255,255,255,0.12); flex-shrink: 0; }
  .flag-placeholder { flex-shrink: 0; opacity: 0.85; }
  .vs { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; color: #444; font-size: 0.8rem; flex-shrink: 0; letter-spacing: 2px; text-transform: uppercase; }
  .score-line { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 14px; margin-bottom: 12px; width: 100%; }
  .score-cluster { display: flex; align-items: center; gap: 8px; flex: 1 1 180px; min-width: 0; max-width: 100%; }
  .score-cluster--home { justify-content: flex-end; }
  /* Same DOM order as home (flag → name → input); reverse on wide screens so the score sits toward the centre */
  .score-cluster--away { justify-content: flex-start; flex-direction: row-reverse; }
  .score-team-inline { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: min(160px, 42vw); }
  .score-inline-name { font-family: 'Barlow', sans-serif; font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.35px; color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .score-input { width: 52px; height: 52px; text-align: center; font-size: 1.6rem; font-weight: 900; font-family: 'Barlow Condensed', sans-serif; background: #000; border: 2px solid #2a2a2a; border-radius: 0; color: ${COLORS.gold}; outline: none; -moz-appearance: textfield; transition: border-color 0.2s, box-shadow 0.2s; flex-shrink: 0; }
  .score-input:focus { border-color: ${COLORS.gold}; box-shadow: 0 0 0 1px rgba(201,168,76,0.3); }
  .score-input::-webkit-inner-spin-button, .score-input::-webkit-outer-spin-button { -webkit-appearance: none; }
  .scorer-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .scorer-label { font-size: 0.7rem; color: #666; white-space: nowrap; font-family: 'Barlow', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .styled-select { flex: 1; min-width: 0; background: #000; border: 1px solid #2a2a2a; border-radius: 0; color: #fff; padding: 10px 10px; font-family: 'Noto Sans', sans-serif; font-size: 0.82rem; outline: none; min-height: 44px; transition: border-color 0.2s; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23666' fill='none' stroke-width='1.5'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 30px; }
  .styled-select:focus { border-color: ${COLORS.gold}; }

  .btn-primary { background: ${COLORS.gold}; color: #000; border: none; border-radius: 0; padding: 14px 28px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.1rem; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; width: 100%; transition: transform 0.1s, background 0.15s; }
  .btn-primary:hover { background: ${COLORS.goldLight}; transform: scale(1.01); }
  .btn-primary:active { transform: scale(0.98); }
  .btn-secondary { background: transparent; color: ${COLORS.gold}; border: 2px solid ${COLORS.gold}; border-radius: 0; padding: 10px 24px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1rem; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; transition: all 0.15s; }
  .btn-secondary:hover { background: rgba(201,168,76,0.1); }

  .standings-grid { display: flex; gap: 8px; margin-bottom: 6px; }
  .standing-slot { flex: 1; background: #000; border: 1px dashed #2a2a2a; border-radius: 0; padding: 8px 6px; text-align: center; min-height: 60px; font-size: 0.72rem; color: #444; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: border-color 0.2s; }
  .standing-slot.filled { border-style: solid; border-color: ${COLORS.gold}; }
  .standing-slot .pos { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 0.72rem; color: #444; margin-bottom: 2px; letter-spacing: 1px; text-transform: uppercase; }
  .standing-slot.filled .pos { color: ${COLORS.gold}; }
  .standing-slot .team-flag { display: flex; align-items: center; justify-content: center; min-height: 28px; }
  .standing-slot .team-nm { font-size: 0.6rem; color: #aaa; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Barlow', sans-serif; }

  .outright-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .outright-card { background: #000; border-radius: 0; border: 1px solid #1e1e1e; padding: 14px; }
  .outright-card label { font-size: 0.68rem; color: #666; display: block; margin-bottom: 8px; font-family: 'Barlow', sans-serif; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .outright-icon { font-size: 1.5rem; margin-bottom: 4px; display: block; }

  .stat-card { background: #000; border-radius: 0; border: 1px solid #1e1e1e; padding: 14px; margin-bottom: 10px; }
  .stat-card label { font-size: 0.7rem; color: #888; display: block; margin-bottom: 4px; font-family: 'Barlow', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .stat-card .hint { font-size: 0.72rem; color: #444; margin-bottom: 8px; font-family: 'Noto Sans', sans-serif; }
  .number-input-row { display: flex; align-items: center; gap: 10px; }
  .num-input { width: 80px; text-align: center; font-size: 1.4rem; font-weight: 900; font-family: 'Barlow Condensed', sans-serif; background: #000; border: 1px solid #2a2a2a; border-radius: 0; color: ${COLORS.gold}; outline: none; padding: 8px; -moz-appearance: textfield; }
  .num-input:focus { border-color: ${COLORS.gold}; }
  .num-input::-webkit-inner-spin-button, .num-input::-webkit-outer-spin-button { -webkit-appearance: none; }
  .num-stepper { width: 38px; height: 38px; background: #111; border: 1px solid #2a2a2a; border-radius: 0; color: #fff; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; }
  .num-stepper:hover { background: ${COLORS.gold}; color: #000; }

  .lb-rank { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.2rem; width: 32px; color: #444; }
  .lb-rank.top1 { color: ${COLORS.gold}; }
  .lb-rank.top2 { color: #c0c0c0; }
  .lb-rank.top3 { color: #cd7f32; }
  .lb-avatar { width: 38px; height: 38px; border-radius: 0; background: #1a1a1a; border: 1px solid #2a2a2a; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 800; color: ${COLORS.gold}; flex-shrink: 0; font-family: 'Barlow Condensed', sans-serif; letter-spacing: 1px; }
  .lb-name { flex: 1; font-weight: 700; font-size: 0.9rem; font-family: 'Barlow', sans-serif; text-transform: uppercase; letter-spacing: 0.5px; }
  .lb-pts { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.3rem; color: ${COLORS.gold}; }

  .progress-bar { height: 3px; background: #1a1a1a; border-radius: 0; margin: 4px 0 12px; overflow: hidden; }
  .progress-fill { height: 100%; background: ${COLORS.gold}; border-radius: 0; transition: width 0.4s ease; }
  .progress-label { font-size: 0.72rem; color: #555; display: flex; justify-content: space-between; font-family: 'Barlow', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

  .signup-card { background: #0d0d0d; border-radius: 0; border: 1px solid #1e1e1e; padding: 2rem; max-width: 440px; margin: 0 auto; }
  .signup-card h2 { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 2rem; letter-spacing: 1px; text-transform: uppercase; color: #fff; margin-bottom: 4px; }
  .signup-card p { font-size: 0.82rem; color: #666; margin-bottom: 1.5rem; font-family: 'Noto Sans', sans-serif; }
  .form-field { margin-bottom: 14px; }
  .form-field label { font-size: 0.68rem; color: #666; font-family: 'Barlow', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; display: block; margin-bottom: 6px; }
  .form-input { width: 100%; background: #000; border: 1px solid #2a2a2a; border-radius: 0; color: #fff; padding: 11px 14px; font-family: 'Noto Sans', sans-serif; font-size: 0.95rem; outline: none; }
  .form-input:focus { border-color: ${COLORS.gold}; }

  .entry-fee-box { display: flex; align-items: center; justify-content: space-between; background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.3); border-radius: 0; padding: 14px; margin: 1rem 0; }
  .entry-fee-box span { font-size: 0.8rem; color: #888; font-family: 'Barlow', sans-serif; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
  .entry-fee-box strong { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.8rem; color: ${COLORS.gold}; }
  .prize-breakdown { background: rgba(255,255,255,0.02); border: 1px solid #1e1e1e; border-radius: 0; padding: 12px 14px; margin-bottom: 1.2rem; }
  .prize-row { display: flex; justify-content: space-between; font-size: 0.82rem; padding: 4px 0; font-family: 'Noto Sans', sans-serif; border-bottom: 1px solid #111; }
  .prize-row:last-child { border-bottom: none; }
  .prize-row span:first-child { color: #666; }
  .prize-row span:last-child { color: ${COLORS.gold}; font-weight: 700; font-family: 'Barlow Condensed', sans-serif; font-size: 0.9rem; letter-spacing: 0.5px; }

  .rules-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rule-card { background: #000; border-radius: 0; padding: 14px; border: 1px solid #1e1e1e; border-left: 3px solid ${COLORS.gold}; }
  .rule-card .rule-icon { font-size: 1.4rem; margin-bottom: 6px; }
  .rule-card h4 { font-size: 0.82rem; font-family: 'Barlow', sans-serif; font-weight: 700; color: #ddd; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .rule-card p { font-size: 0.73rem; color: #666; line-height: 1.5; }

  .toast { position: fixed; bottom: max(90px, calc(70px + env(safe-area-inset-bottom, 0px))); left: 50%; transform: translateX(-50%); background: ${COLORS.gold}; color: #000; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; padding: 12px 28px; border-radius: 0; font-size: 0.9rem; z-index: 999; animation: slideUp 0.3s ease; }
  @keyframes slideUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

  .tag { display: inline-block; background: rgba(201,168,76,0.1); color: ${COLORS.gold}; border-radius: 0; border: 1px solid rgba(201,168,76,0.3); padding: 2px 8px; font-size: 0.68rem; font-family: 'Barlow', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }

  .group-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .group-tab { background: #000; border: 1px solid #2a2a2a; border-radius: 0; padding: 6px 14px; font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 0.85rem; letter-spacing: 1px; text-transform: uppercase; color: #555; cursor: pointer; transition: all 0.15s; }
  .group-tab.active { background: ${COLORS.gold}; color: #000; border-color: transparent; }
  .group-tab:hover:not(.active) { border-color: #444; color: #ccc; }

  .completion-badge { display: inline-flex; align-items: center; gap: 4px; background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.4); border-radius: 0; padding: 2px 10px; font-size: 0.68rem; font-family: 'Barlow', sans-serif; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: ${COLORS.gold}; }

  .drag-team-pool { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .drag-team { background: #111; border-radius: 0; padding: 6px 12px; font-size: 0.75rem; font-family: 'Barlow', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; border: 1px solid #2a2a2a; transition: all 0.15s; display: flex; align-items: center; gap: 5px; }
  .drag-team:hover { border-color: ${COLORS.gold}; color: ${COLORS.gold}; }
  .drag-team.selected { border-color: ${COLORS.gold}; background: rgba(201,168,76,0.1); color: ${COLORS.gold}; }

  .live-badge { display: inline-flex; align-items: center; gap: 4px; background: rgba(255,50,50,0.12); border: 1px solid rgba(255,50,50,0.35); padding: 3px 10px; font-size: 0.68rem; font-family: 'Barlow', sans-serif; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #ff4444; animation: livePulse 1.5s ease-in-out infinite; }
  @keyframes livePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .ft-badge { display: inline-block; background: rgba(76,175,80,0.1); border: 1px solid rgba(76,175,80,0.35); padding: 3px 10px; font-size: 0.68rem; font-family: 'Barlow', sans-serif; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #4CAF50; }

  .actual-result { margin-top: 16px; padding: 14px 16px; background: linear-gradient(180deg, rgba(201,168,76,0.04) 0%, rgba(0,0,0,0) 100%); border-top: 2px solid ${COLORS.gold}; text-align: center; }
  .actual-result-label { font-family: 'Barlow Condensed', sans-serif; font-size: 0.68rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: ${COLORS.gold}; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .actual-result-label::before, .actual-result-label::after { content: ''; flex: 1; max-width: 40px; height: 1px; background: rgba(201,168,76,0.25); }
  .actual-score-row { display: flex; align-items: center; gap: 14px; justify-content: center; padding: 4px 0; }
  .actual-score-val { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 2.2rem; color: #fff; min-width: 40px; text-align: center; line-height: 1; }
  .actual-score-divider { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.4rem; color: #333; }
  .match-pts-earned { margin-top: 10px; padding: 8px 12px; background: rgba(76,175,80,0.06); border: 1px solid rgba(76,175,80,0.15); display: inline-block; }
  .match-pts-earned.zero { background: transparent; border-color: transparent; }
  .match-pts-total { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.1rem; color: #4CAF50; letter-spacing: 0.5px; }
  .match-pts-detail { display: block; font-size: 0.7rem; color: #888; margin-top: 3px; font-family: 'Noto Sans', sans-serif; }

  .lb-row { display: flex; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 1px solid #1a1a1a; transition: background 0.15s; }
  .lb-row:last-child { border-bottom: none; }
  .lb-row.clickable { cursor: pointer; }
  .lb-row.clickable:hover { background: rgba(201,168,76,0.04); }
  .lb-row.expanded { border-bottom: none; }
  .lb-you { background: rgba(201,168,76,0.05); border-left: 3px solid ${COLORS.gold}; padding-left: 11px; margin: 0 -14px; padding-right: 14px; }
  .lb-breakdown { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
  .lb-cat { font-size: 0.65rem; color: #555; font-family: 'Noto Sans', sans-serif; padding: 1px 6px; background: rgba(255,255,255,0.03); border: 1px solid #1a1a1a; }
  .lb-cat span { color: ${COLORS.gold}; font-weight: 700; }
  .lb-chevron { font-size: 0.65rem; color: #444; transition: transform 0.2s; flex-shrink: 0; }
  .lb-chevron.open { transform: rotate(180deg); }
  .lb-pred-panel { background: #0c0c0c; border: 1px solid #222; border-top: none; margin: 0 -14px; padding: 14px; margin-bottom: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .lb-pred-panel .group-tabs { margin-bottom: 10px; flex-wrap: wrap; gap: 4px; }
  .lb-pred-panel .group-tab { font-size: 0.68rem; padding: 4px 8px; }
  .pred-table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }
  .pred-table td { padding: 5px 6px; border-bottom: 1px solid #181818; vertical-align: middle; white-space: nowrap; }
  .pred-table tr:last-child td { border-bottom: none; }
  .pred-team { max-width: 110px; overflow: hidden; text-overflow: ellipsis; color: #bbb; }
  .pred-team--home { text-align: right; }
  .pred-team--away { text-align: left; }
  .pred-team span { vertical-align: middle; margin: 0 4px; }
  .pred-score { text-align: center; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1rem; color: ${COLORS.gold}; width: 56px; letter-spacing: 1px; }
  .pred-scorer { color: #555; font-size: 0.65rem; padding-left: 8px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
  .pred-outrights { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; margin-top: 10px; }
  .pred-outright-item { background: #111; border: 1px solid #1e1e1e; padding: 7px 10px; }
  .pred-outright-label { font-size: 0.62rem; color: #555; font-family: 'Barlow', sans-serif; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 3px; }
  .pred-outright-val { font-size: 0.78rem; color: #ccc; font-weight: 600; font-family: 'Barlow', sans-serif; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lb-locked-notice { display: flex; align-items: center; gap: 10px; background: rgba(201,168,76,0.04); border: 1px solid rgba(201,168,76,0.15); padding: 16px; margin-bottom: 16px; }
  .lb-locked-notice-icon { font-size: 1.4rem; flex-shrink: 0; }
  .lb-locked-notice-text { font-size: 0.82rem; color: #888; font-family: 'Noto Sans', sans-serif; line-height: 1.5; }

  .card { background: #0d0d0d; border: 1px solid #1e1e1e; overflow: hidden; margin-bottom: 12px; transition: border-color 0.2s; }
  .card:hover { border-color: #2a2a2a; }

  .submit-card { background: #0d0d0d; border: 1px solid #1e1e1e; padding: 1.5rem; max-width: 520px; margin: 0 auto; }
  .submit-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.6rem; letter-spacing: 1px; text-transform: uppercase; color: #fff; margin-bottom: 8px; }
  .submit-checklist { margin: 1rem 0; }
  .submit-check-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #111; font-family: 'Barlow', sans-serif; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .submit-check-row:last-child { border-bottom: none; }
  .submit-check-icon { font-size: 1.1rem; width: 24px; text-align: center; }
  .submit-check-label { flex: 1; color: #aaa; }
  .submit-check-row.done .submit-check-label { color: #4CAF50; }
  .submit-check-row.partial .submit-check-label { color: #ff9800; }
  .submit-check-pct { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 0.9rem; color: #555; }
  .submit-check-row.done .submit-check-pct { color: #4CAF50; }

  .submit-paid { background: rgba(76,175,80,0.06); border: 2px solid rgba(76,175,80,0.3); padding: 1.5rem; text-align: center; margin: 1rem 0; }
  .submit-paid-icon { font-size: 2.5rem; margin-bottom: 8px; }
  .submit-paid-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.4rem; color: #4CAF50; text-transform: uppercase; letter-spacing: 1px; }
  .submit-paid-sub { font-size: 0.82rem; color: #666; margin-top: 4px; }

  .submit-email-opt { display: flex; align-items: center; gap: 10px; padding: 12px 0; margin: 8px 0; cursor: pointer; }
  .submit-email-opt input[type="checkbox"] { width: 20px; height: 20px; accent-color: ${COLORS.gold}; cursor: pointer; }
  .submit-email-opt span { font-size: 0.82rem; color: #888; font-family: 'Noto Sans', sans-serif; }

  .btn-pay { background: linear-gradient(135deg, #635bff 0%, #7c3aed 100%); color: #fff; border: none; border-radius: 0; padding: 16px 28px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.1rem; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; width: 100%; transition: transform 0.1s, opacity 0.15s; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .btn-pay:hover { opacity: 0.9; transform: scale(1.01); }
  .btn-pay:active { transform: scale(0.98); }
  .btn-pay:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .btn-pay svg { width: 20px; height: 20px; }

  .locked-banner { background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.25); padding: 10px 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: ${COLORS.gold}; font-family: 'Barlow', sans-serif; font-weight: 600; }

  .deadline-banner { background: rgba(30,40,60,0.35); border-bottom: 1px solid rgba(201,168,76,0.2); padding: 10px 1.5rem; font-family: 'Barlow', sans-serif; font-size: 0.78rem; font-weight: 600; color: #b8c4d9; text-align: center; letter-spacing: 0.3px; }
  .deadline-banner strong { color: ${COLORS.gold}; font-weight: 800; }
  .deadline-banner.closed { background: rgba(80,40,40,0.2); border-bottom-color: rgba(200,80,80,0.25); color: #c9a0a0; }
  .deadline-banner.closed strong { color: #e57373; }

  .match-pts-pill { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1rem; padding: 4px 12px; border-radius: 2px; background: rgba(76,175,80,0.12); border: 1px solid rgba(76,175,80,0.35); color: #81c784; letter-spacing: 0.5px; }
  .match-pts-pill.muted { background: rgba(255,255,255,0.04); border-color: #333; color: #666; }
  .actual-result-pending { font-size: 0.82rem; color: #666; font-family: 'Noto Sans', sans-serif; padding: 6px 0; }
  .match-pts-total-big { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.65rem; color: #4CAF50; letter-spacing: 1px; display: block; line-height: 1.2; }

  .lp-deadline-bar { max-width: 520px; margin: 0 auto 20px; padding: 14px 18px; background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.25); font-family: 'Barlow', sans-serif; font-size: 0.82rem; color: #aaa; line-height: 1.5; }
  .lp-deadline-bar .lp-deadline-count { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.15rem; color: ${COLORS.gold}; letter-spacing: 1px; display: block; margin-top: 6px; }
  .lp-signup-closed { background: #0d0d0d; border: 1px solid rgba(200,80,80,0.35); padding: 2rem; max-width: 440px; margin: 0 auto; text-align: center; }
  .lp-signup-closed-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.4rem; color: #e57373; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
  .lp-signup-closed-sub { font-size: 0.88rem; color: #888; line-height: 1.6; font-family: 'Noto Sans', sans-serif; }
  .score-input:disabled, .styled-select:disabled, .num-input:disabled { opacity: 0.55; cursor: not-allowed; }
  .num-stepper:disabled { opacity: 0.4; cursor: not-allowed; }
  .standings-readonly .drag-team, .standings-readonly .standing-slot { pointer-events: none; opacity: 0.85; }

  /* --- Landing page --- */
  .lp { overflow-x: hidden; }
  .lp-hero { position: relative; padding: 4rem 1.5rem 3rem; text-align: center; overflow: hidden; }
  .lp-hero::before { content: ''; position: absolute; inset: 0; opacity: 0.03; background-image: repeating-linear-gradient(0deg, transparent, transparent 38px, #fff 38px, #fff 39px), repeating-linear-gradient(90deg, transparent, transparent 38px, #fff 38px, #fff 39px); pointer-events: none; }
  .lp-hero-eyebrow { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 0.72rem; letter-spacing: 5px; text-transform: uppercase; color: #555; margin-bottom: 12px; position: relative; }
  .lp-hero-big { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 4rem; line-height: 1; color: #fff; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; position: relative; }
  .lp-hero-big em { color: ${COLORS.gold}; font-style: normal; }
  .lp-hero-sub { font-family: 'Noto Sans', sans-serif; font-size: 1.1rem; color: #888; max-width: 520px; margin: 0 auto 24px; line-height: 1.6; position: relative; }
  .lp-hero-btns { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
  .lp-hero-cta { display: inline-flex; align-items: center; gap: 8px; background: ${COLORS.gold}; color: #000; border: none; padding: 16px 36px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.15rem; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; transition: all 0.15s; position: relative; text-decoration: none; }
  .lp-hero-cta:hover { background: ${COLORS.goldLight}; transform: scale(1.02); }
  .lp-hero-ghost { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: ${COLORS.gold}; border: 2px solid rgba(201,168,76,0.4); padding: 14px 28px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1rem; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; transition: all 0.15s; text-decoration: none; }
  .lp-hero-ghost:hover { border-color: ${COLORS.gold}; background: rgba(201,168,76,0.06); }
  .lp-hero-flags { font-size: 2rem; margin-top: 28px; letter-spacing: 4px; position: relative; opacity: 0.7; }
  .lp-hero-divider { height: 3px; background: ${COLORS.gold}; }

  .lp-section { padding: 3rem 1.5rem; max-width: 800px; margin: 0 auto; }
  .lp-section-alt { background: #060608; }
  .lp-section-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 2.2rem; letter-spacing: 1px; text-transform: uppercase; color: #fff; text-align: center; margin-bottom: 4px; }
  .lp-section-title em { color: ${COLORS.gold}; font-style: normal; }
  .lp-section-line { width: 40px; height: 3px; background: ${COLORS.gold}; margin: 0 auto 12px; }
  .lp-section-sub { text-align: center; font-size: 0.9rem; color: #666; margin-bottom: 2.5rem; max-width: 500px; margin-left: auto; margin-right: auto; line-height: 1.6; }

  .lp-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 2rem; }
  .lp-step { text-align: center; padding: 20px 12px; position: relative; }
  .lp-step-num { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 3rem; color: rgba(201,168,76,0.12); line-height: 1; margin-bottom: 4px; }
  .lp-step-icon { font-size: 2rem; margin-bottom: 8px; }
  .lp-step-label { font-family: 'Barlow', sans-serif; font-weight: 700; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.5px; color: #ccc; margin-bottom: 4px; }
  .lp-step-desc { font-size: 0.75rem; color: #555; line-height: 1.5; }
  .lp-step-arrow { position: absolute; right: -14px; top: 50%; color: #2a2a2a; font-size: 1.2rem; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; }

  .lp-cats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .lp-cat { background: #0a0a0a; border: 1px solid #1e1e1e; padding: 20px; transition: border-color 0.2s; }
  .lp-cat:hover { border-color: rgba(201,168,76,0.3); }
  .lp-cat-icon { font-size: 1.8rem; margin-bottom: 8px; }
  .lp-cat-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 1px; color: #fff; margin-bottom: 4px; }
  .lp-cat-desc { font-size: 0.78rem; color: #666; line-height: 1.5; }
  .lp-cat-pts { display: inline-block; margin-top: 8px; font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 0.78rem; color: ${COLORS.gold}; letter-spacing: 1px; text-transform: uppercase; padding: 2px 8px; background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.2); }

  .lp-scoring { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .lp-score-card { background: #0a0a0a; border: 1px solid #1e1e1e; padding: 16px; text-align: center; }
  .lp-score-pts { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 2.4rem; color: ${COLORS.gold}; line-height: 1; }
  .lp-score-pts small { font-size: 0.9rem; font-weight: 700; color: #666; }
  .lp-score-label { font-family: 'Barlow', sans-serif; font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-top: 4px; }

  .lp-prizes { max-width: 440px; margin: 0 auto; }
  .lp-prize-total { text-align: center; margin-bottom: 20px; }
  .lp-prize-total-label { font-family: 'Barlow', sans-serif; font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 2px; color: #555; }
  .lp-prize-total-val { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 3.5rem; color: ${COLORS.gold}; line-height: 1.1; }
  .lp-prize-total-note { font-size: 0.75rem; color: #444; }
  .lp-prize-row { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: #0a0a0a; border: 1px solid #1e1e1e; margin-bottom: 8px; }
  .lp-prize-medal { font-size: 1.6rem; width: 32px; text-align: center; }
  .lp-prize-place { flex: 1; font-family: 'Barlow', sans-serif; font-weight: 700; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px; }
  .lp-prize-pct { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 1.4rem; color: ${COLORS.gold}; }

  .lp-faq { max-width: 600px; margin: 0 auto; }
  .lp-faq-item { border-bottom: 1px solid #1a1a1a; }
  .lp-faq-q { padding: 16px 0; font-family: 'Barlow', sans-serif; font-weight: 700; font-size: 0.95rem; color: #ddd; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .lp-faq-q:hover { color: ${COLORS.gold}; }
  .lp-faq-toggle { font-family: 'Barlow Condensed', sans-serif; font-size: 1.3rem; color: #444; transition: transform 0.2s; flex-shrink: 0; }
  .lp-faq-toggle.open { transform: rotate(45deg); color: ${COLORS.gold}; }
  .lp-faq-a { padding: 0 0 16px; font-size: 0.85rem; color: #666; line-height: 1.65; }

  .lp-cta-section { padding: 3rem 1.5rem; text-align: center; background: linear-gradient(180deg, #060608 0%, #0a0a0a 50%, rgba(201,168,76,0.03) 100%); }
  .lp-cta-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 2.4rem; text-transform: uppercase; letter-spacing: 1px; color: #fff; margin-bottom: 8px; }
  .lp-cta-title em { color: ${COLORS.gold}; font-style: normal; }
  .lp-cta-sub { font-size: 0.9rem; color: #666; margin-bottom: 2rem; }

  .lp-signup-form { background: #0d0d0d; border: 1px solid #1e1e1e; padding: 2rem; max-width: 440px; margin: 0 auto; text-align: left; }
  .lp-auth-tabs { display: flex; gap: 0; margin-bottom: 1.25rem; border-bottom: 1px solid #2a2a2a; }
  .lp-auth-tab { flex: 1; padding: 10px 6px; font-family: 'Barlow', sans-serif; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; background: none; border: none; color: #555; cursor: pointer; border-bottom: 2px solid transparent; transition: color 0.2s; }
  .lp-auth-tab:hover { color: #aaa; }
  .lp-auth-tab.active { color: ${COLORS.gold}; border-bottom-color: ${COLORS.gold}; }
  .lp-auth-hint { font-size: 0.72rem; color: #666; margin-top: 6px; line-height: 1.45; font-family: 'Noto Sans', sans-serif; }
  .lp-auth-link { background: none; border: none; color: #888; font-size: 0.72rem; cursor: pointer; text-decoration: underline; margin-top: 10px; padding: 0; font-family: inherit; display: inline; }
  .lp-auth-link:hover { color: ${COLORS.gold}; }
  .lp-auth-note { font-size: 0.82rem; color: #888; margin-bottom: 1rem; line-height: 1.5; }
  .lp-trust { display: flex; justify-content: center; gap: 24px; margin-top: 2rem; flex-wrap: wrap; }
  .lp-trust-item { display: flex; align-items: center; gap: 6px; font-family: 'Barlow', sans-serif; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
  .lp-trust-icon { font-size: 1rem; }

  .lp-footer { text-align: center; padding: 2rem 1.5rem; border-top: 1px solid #111; }
  .lp-footer-text { font-size: 0.72rem; color: #333; font-family: 'Noto Sans', sans-serif; }

  /* Match cards: stack teams vertically so each row reads flag → name → score (avoids zig-zag on phones / narrow tablets) */
  @media (max-width: 640px) {
    .score-line {
      flex-direction: column;
      flex-wrap: nowrap;
      align-items: stretch;
      gap: 4px 0;
    }
    .score-line .vs {
      align-self: center;
      margin: 4px 0;
      font-size: 0.72rem;
      letter-spacing: 3px;
    }
    .score-cluster--home,
    .score-cluster--away {
      flex: none;
      width: 100%;
      max-width: none;
      justify-content: space-between;
      flex-direction: row;
    }
    .score-cluster--home .score-team-inline,
    .score-cluster--away .score-team-inline {
      flex: 1;
      min-width: 0;
      max-width: none;
      justify-content: flex-start;
    }
  }

  /* --- Responsive: tablet --- */
  @media (max-width: 768px) {
    .hero-inner { padding: 1.5rem 1rem 1.2rem; }
    .section { padding: 1.2rem; }
    .outright-grid { gap: 8px; }
    .standings-grid { gap: 6px; }
    .lp-steps { grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .lp-step-arrow { display: none; }
    .lp-section { padding: 2.5rem 1.2rem; }
    .lp-hero { padding: 3rem 1.2rem 2.5rem; }
    .lp-scoring { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .lp-cats { grid-template-columns: 1fr; gap: 10px; }
    .rules-grid { grid-template-columns: 1fr; }
    .outright-grid { grid-template-columns: 1fr 1fr; }
  }

  /* --- Responsive: mobile --- */
  @media (max-width: 480px) {
    .hero-26 { font-size: 5rem; letter-spacing: -3px; }
    .hero-weare { font-size: 1.3rem; letter-spacing: 1px; }
    .hero-tags { gap: 4px; }
    .hero-tag { font-size: 0.65rem; padding: 3px 8px; }
    .hero-inner { padding: 1.2rem 0.8rem 1rem; }

    .lp-hero { padding: 2.5rem 1rem 2rem; }
    .lp-hero-big { font-size: 2.4rem; letter-spacing: 1px; }
    .lp-hero-sub { font-size: 0.92rem; }
    .lp-hero-btns { flex-direction: column; align-items: stretch; gap: 10px; max-width: 340px; margin: 0 auto; }
    .lp-hero-cta { padding: 14px 24px; font-size: 1rem; width: 100%; justify-content: center; }
    .lp-hero-ghost { padding: 12px 20px; font-size: 0.9rem; width: 100%; justify-content: center; }
    .lp-hero-flags { font-size: 1.5rem; letter-spacing: 2px; }
    .lp-section { padding: 2rem 1rem; }
    .lp-section-title { font-size: 1.6rem; }
    .lp-section-sub { font-size: 0.82rem; margin-bottom: 1.5rem; }
    .lp-steps { grid-template-columns: 1fr 1fr; gap: 10px; }
    .lp-step { padding: 14px 8px; }
    .lp-step-num { font-size: 2.2rem; }
    .lp-step-icon { font-size: 1.6rem; }
    .lp-step-label { font-size: 0.75rem; }
    .lp-step-desc { font-size: 0.7rem; }
    .lp-cats { grid-template-columns: 1fr; gap: 10px; }
    .lp-scoring { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .lp-score-card { padding: 12px 6px; }
    .lp-score-pts { font-size: 1.8rem; }
    .lp-score-label { font-size: 0.65rem; }
    .lp-prize-total-val { font-size: 2.8rem; }
    .lp-cta-section { padding: 2rem 1rem; }
    .lp-cta-title { font-size: 1.8rem; }
    .lp-signup-form { padding: 1.2rem; }
    .lp-trust { gap: 16px; }

    .section { padding: 1rem 0.75rem; }
    .section-title { font-size: 1.5rem; }
    .section-sub { font-size: 0.78rem; }

    .nav-btn { padding: 12px 14px; font-size: 0.78rem; letter-spacing: 0.5px; }

    .group-tabs { gap: 4px; }
    .group-tab { padding: 6px 10px; font-size: 0.78rem; min-height: 36px; }

    .card-header { padding: 8px 10px; flex-wrap: wrap; gap: 6px; }
    .match-row { padding: 12px 10px; }
    .score-inline-name { font-size: 0.65rem; }
    .score-team-inline { max-width: none; }
    .score-input { width: 48px; height: 48px; font-size: 1.4rem; }
    .scorer-row { flex-direction: column; align-items: stretch; gap: 6px; }
    .scorer-label { text-align: left; }
    .styled-select { width: 100%; flex: none; }

    .actual-result { padding: 12px; margin-top: 12px; }
    .actual-score-val { font-size: 1.8rem; min-width: 32px; }
    .match-pts-earned { padding: 6px 10px; }

    .standings-grid { flex-wrap: wrap; gap: 6px; }
    .standing-slot { flex: 1 1 calc(50% - 3px); min-width: calc(50% - 3px); min-height: 68px; }
    .drag-team { padding: 6px 10px; font-size: 0.7rem; }
    .drag-team-pool { gap: 6px; }

    .outright-grid { grid-template-columns: 1fr; }
    .outright-card { padding: 12px; }

    .rules-grid { grid-template-columns: 1fr; }
    .rule-card { padding: 12px; }

    .stat-card { padding: 12px; }
    .num-stepper { width: 44px; height: 44px; font-size: 1.3rem; }

    .lb-row { gap: 8px; padding: 12px 0; }
    .lb-rank { font-size: 1rem; width: 28px; }
    .lb-avatar { width: 34px; height: 34px; font-size: 0.65rem; }
    .lb-pts { font-size: 1.1rem; }
    .lb-name { font-size: 0.82rem; }
    .lb-breakdown { gap: 4px; }
    .lb-cat { font-size: 0.58rem; padding: 1px 4px; }
    .lb-you { margin: 0 -10px; padding-left: 10px; padding-right: 10px; }

    /* Prevent iOS auto-zoom: font-size must be ≥ 16px on focusable inputs */
    .form-input { font-size: 1rem; }
    .styled-select { font-size: 1rem; }

    .signup-card { padding: 1.2rem; width: 100%; }
    .submit-card { padding: 1.2rem; width: 100%; }
    .lp-signup-form { padding: 1.2rem; width: 100%; }
    .lp-signup-closed { padding: 1.5rem 1.2rem; width: 100%; }
    .entry-fee-box strong { font-size: 1.5rem; }
    .btn-primary { padding: 16px 20px; font-size: 1rem; min-height: 52px; }
    .btn-pay { padding: 16px 20px; font-size: 1rem; min-height: 52px; }
    .btn-secondary { padding: 12px 20px; font-size: 0.95rem; width: 100%; }

    .lp-auth-tab { min-height: 44px; font-size: 0.72rem; }
    .lp-auth-hint { font-size: 0.75rem; }

    .progress-label { font-size: 0.68rem; }
    .toast { font-size: 0.82rem; padding: 10px 20px; max-width: calc(100vw - 32px); text-align: center; }

    /* Leaderboard row tightening */
    .lb-pred-panel { margin: 0 -10px; padding: 12px 10px; }
    .pred-table { font-size: 0.68rem; }
    .pred-team { max-width: 80px; }
    .pred-outrights { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 4px; }

    /* Submit checklist */
    .submit-check-row { font-size: 0.78rem; padding: 10px 0; gap: 8px; }
  }

  /* --- Responsive: small phones --- */
  @media (max-width: 360px) {
    .hero-26 { font-size: 4rem; }
    .hero-weare { font-size: 1rem; }
    .hero-eyebrow { font-size: 0.65rem; letter-spacing: 3px; }
    .section-title { font-size: 1.3rem; }
    .score-input { width: 44px; height: 44px; font-size: 1.2rem; }
    .actual-score-val { font-size: 1.5rem; }
    .group-tab { padding: 5px 8px; font-size: 0.72rem; }
    .nav-btn { padding: 12px 10px; font-size: 0.72rem; }
    .lb-breakdown { gap: 3px; }
    .lb-cat { font-size: 0.55rem; }
    .lb-avatar { width: 30px; height: 30px; }
    .signup-card { padding: 1rem; }
    .signup-card h2 { font-size: 1.6rem; }
    .submit-card { padding: 1rem; }
    .submit-title { font-size: 1.3rem; }
    .lp-hero-big { font-size: 2rem; }
    .lp-hero-btns { max-width: 100%; }
    .lp-section-title { font-size: 1.4rem; }
    .lp-cta-title { font-size: 1.5rem; }
    .lp-scoring { grid-template-columns: repeat(2, 1fr); }
    .lp-signup-form { padding: 1rem; }
    .form-input { font-size: 1rem; padding: 10px 12px; }
    .lp-steps { grid-template-columns: 1fr; }
    .lb-pred-panel { margin: 0 -8px; padding: 10px 8px; }
  }
`;

function ScoreInput({ value, onChange, label, disabled }) {
  return (
    <input
      type="number"
      className="score-input"
      value={value === "" ? "" : value}
      onChange={e => onChange(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value) || 0))}
      min={0}
      max={20}
      placeholder="0"
      aria-label={label || "Score"}
      inputMode="numeric"
      disabled={disabled}
    />
  );
}

function NumberStepper({ value, onChange, min = 0, max = 999, label, disabled }) {
  return (
    <div className="number-input-row" role="group" aria-label={label || "Number input"}>
      <button type="button" className="num-stepper" disabled={disabled} onClick={() => !disabled && onChange(Math.max(min, (value || 0) - 1))} aria-label="Decrease">−</button>
      <input
        type="number"
        className="num-input"
        value={value === "" ? "" : value}
        onChange={e => !disabled && onChange(e.target.value === "" ? "" : Math.max(min, parseInt(e.target.value) || 0))}
        aria-label={label || "Value"}
        inputMode="numeric"
        disabled={disabled}
      />
      <button type="button" className="num-stepper" disabled={disabled} onClick={() => !disabled && onChange(Math.min(max, (value || 0) + 1))} aria-label="Increase">+</button>
    </div>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lp-faq-item">
      <div className="lp-faq-q" onClick={() => setOpen(o => !o)}>
        <span>{q}</span>
        <span className={`lp-faq-toggle${open ? " open" : ""}`}>+</span>
      </div>
      {open && <div className="lp-faq-a">{a}</div>}
    </div>
  );
}

function SignupScreen({
  needsProfileCompletion,
  onCompleteProfile,
  onPasswordSignUp,
  onPasswordSignIn,
  onForgotPassword,
  onLocalComplete,
  submissionClosed,
  countdownLabel,
  deadlineLabel,
  firstKickoffLabel,
}) {
  const [authTab, setAuthTab] = useState("signup");
  const [form, setForm] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    password2: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const scrollToSignup = () => {
    document.getElementById("lp-signup")?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSignUp = async () => {
    if (!form.name?.trim() || !form.email?.trim()) return;
    if (!form.password || form.password.length < 6) return;
    if (form.password !== form.password2) return;
    setBusy(true);
    try {
      const result = await onPasswordSignUp({
        name: form.name.trim(),
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
      });
      // If the account already exists in auth but not in profiles, switch to
      // the sign-in tab so the user can log in without re-entering their email.
      if (result?.switchToSignIn) {
        setAuthTab("signin");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async () => {
    if (!form.email?.trim() || !form.password) return;
    setBusy(true);
    try {
      await onPasswordSignIn(form.email.trim(), form.password);
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    if (!form.email?.trim()) return;
    setBusy(true);
    try {
      await onForgotPassword(form.email.trim());
    } finally {
      setBusy(false);
    }
  };

  const handleProfileOnly = async () => {
    if (!form.name?.trim()) return;
    setBusy(true);
    try {
      await onCompleteProfile({ name: form.name.trim(), username: form.username.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lp">
      {/* ── HERO ─────────────────────────────────────────────────── */}
      <div className="lp-hero">
        <div className="lp-hero-eyebrow">FIFA World Cup 2026 — USA · Canada · Mexico</div>
        <div className="lp-hero-big">
          Predict. <em>Compete.</em> Win.
        </div>
        <div className="lp-hero-sub">
          {submissionClosed
            ? "Submissions for this pool are closed. The entry deadline was one hour before the first match."
            : "Think you know football? Put your predictions to the test across all 48 group stage matches, pick the outright winners, and compete for a real cash prize pool."}
        </div>
        {!submissionClosed && countdownLabel && (
          <div className="lp-deadline-bar">
            <span>Entries close <strong>{deadlineLabel}</strong> — one hour before kick-off ({firstKickoffLabel}).</span>
            <span className="lp-deadline-count">{countdownLabel}</span>
          </div>
        )}
        <div className="lp-hero-btns">
          {submissionClosed ? (
            <button type="button" className="lp-hero-cta" style={{ opacity: 0.5, cursor: "not-allowed" }} disabled>
              Submissions closed
            </button>
          ) : (
            <button type="button" className="lp-hero-cta" onClick={scrollToSignup}>
              Enter Now — £10
            </button>
          )}
          <button type="button" className="lp-hero-ghost" onClick={() => document.getElementById("lp-how")?.scrollIntoView({ behavior: "smooth" })}>
            How It Works ↓
          </button>
        </div>
      </div>
      <div className="lp-hero-divider" />

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <div id="lp-how" className="lp-section-alt">
        <div className="lp-section">
          <div className="lp-section-title">How It <em>Works</em></div>
          <div className="lp-section-line" />
          <div className="lp-section-sub">
            Four simple steps from signup to prize day. No complicated rules, no fantasy squads — just pure prediction skill.
          </div>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">01</div>
              <div className="lp-step-icon">✍️</div>
              <div className="lp-step-label">Sign Up</div>
              <div className="lp-step-desc">Create your account with email and password</div>
              <span className="lp-step-arrow">→</span>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">02</div>
              <div className="lp-step-icon">⚽</div>
              <div className="lp-step-label">Predict</div>
              <div className="lp-step-desc">Fill in scores, standings, and outrights</div>
              <span className="lp-step-arrow">→</span>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">03</div>
              <div className="lp-step-icon">💳</div>
              <div className="lp-step-label">Pay £10</div>
              <div className="lp-step-desc">Lock in your predictions with a secure Stripe payment</div>
              <span className="lp-step-arrow">→</span>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">04</div>
              <div className="lp-step-icon">🏆</div>
              <div className="lp-step-label">Win</div>
              <div className="lp-step-desc">Track the live leaderboard and claim your prize</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── WHAT YOU PREDICT ─────────────────────────────────────── */}
      <div className="lp-section">
        <div className="lp-section-title">What You <em>Predict</em></div>
        <div className="lp-section-line" />
        <div className="lp-section-sub">
          More than just match scores. Test your football knowledge across three areas — including total tournament goals as the leaderboard tiebreaker.
        </div>
        <div className="lp-cats">
          <div className="lp-cat">
            <div className="lp-cat-icon">🥅</div>
            <div className="lp-cat-title">Match Scores</div>
            <div className="lp-cat-desc">
              Predict the exact score for all 48 group stage matches. Nail the result for points — get the exact score for a bonus.
            </div>
            <div className="lp-cat-pts">Up to 10pts per match</div>
          </div>
          <div className="lp-cat">
            <div className="lp-cat-icon">📊</div>
            <div className="lp-cat-title">Group Standings</div>
            <div className="lp-cat-desc">
              Pick which teams finish 1st and 2nd in each of the 12 groups. Get the order right for maximum points.
            </div>
            <div className="lp-cat-pts">Up to 5pts per group</div>
          </div>
          <div className="lp-cat">
            <div className="lp-cat-icon">🏆</div>
            <div className="lp-cat-title">Outrights</div>
            <div className="lp-cat-desc">
              Winner, Golden Boot, England’s run, highest-scoring team — plus total goals in the tournament (exact or within ±3 for points, and closest to the real total breaks ties on the leaderboard).
            </div>
            <div className="lp-cat-pts">Up to 15pts per pick</div>
          </div>
        </div>
      </div>

      {/* ── SCORING SYSTEM ───────────────────────────────────────── */}
      <div className="lp-section-alt">
        <div className="lp-section">
          <div className="lp-section-title">Points <em>Breakdown</em></div>
          <div className="lp-section-line" />
          <div className="lp-section-sub">
            Every prediction earns points. The more precise you are, the bigger the reward.
          </div>
          <div className="lp-scoring">
            <div className="lp-score-card">
              <div className="lp-score-pts">3<small>pts</small></div>
              <div className="lp-score-label">Correct Result</div>
            </div>
            <div className="lp-score-card">
              <div className="lp-score-pts">5<small>pts</small></div>
              <div className="lp-score-label">Exact Score</div>
            </div>
            <div className="lp-score-card">
              <div className="lp-score-pts">2<small>pts</small></div>
              <div className="lp-score-label">Anytime Scorer</div>
            </div>
            <div className="lp-score-card">
              <div className="lp-score-pts">3<small>pts</small></div>
              <div className="lp-score-label">Group Winner</div>
            </div>
            <div className="lp-score-card">
              <div className="lp-score-pts">15<small>pts</small></div>
              <div className="lp-score-label">Tournament Winner</div>
            </div>
            <div className="lp-score-card">
              <div className="lp-score-pts">10<small> / 5</small></div>
              <div className="lp-score-label">Total goals exact / ±3</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PRIZES ───────────────────────────────────────────────── */}
      <div className="lp-section">
        <div className="lp-section-title">Prize <em>Pool</em></div>
        <div className="lp-section-line" />
        <div className="lp-section-sub">
          {COST_PERCENT > 0
            ? `${COST_PERCENT}% is deducted for costs, then the remaining prize pool is paid out. The more players, the bigger the prizes.`
            : "100% of entry fees go to the prize pool. The more players, the bigger the prizes."}
        </div>
        <div className="lp-prizes">
          <div className="lp-prize-total">
            <div className="lp-prize-total-label">Example pool (20 players)</div>
            <div className="lp-prize-total-val">£200</div>
            <div className="lp-prize-total-note">grows with every entry</div>
          </div>
          <div className="lp-prize-row">
            <span className="lp-prize-medal">🥇</span>
            <span className="lp-prize-place">1st Place</span>
            <span className="lp-prize-pct">60%</span>
          </div>
          <div className="lp-prize-row">
            <span className="lp-prize-medal">🥈</span>
            <span className="lp-prize-place">2nd Place</span>
            <span className="lp-prize-pct">25%</span>
          </div>
          <div className="lp-prize-row">
            <span className="lp-prize-medal">🥉</span>
            <span className="lp-prize-place">3rd Place</span>
            <span className="lp-prize-pct">10%</span>
          </div>
          <div className="lp-prize-row">
            <span className="lp-prize-medal">👟</span>
            <span className="lp-prize-place">Closest Golden Boot</span>
            <span className="lp-prize-pct">5%</span>
          </div>
        </div>
      </div>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <div className="lp-section-alt">
        <div className="lp-section">
          <div className="lp-section-title"><em>FAQ</em></div>
          <div className="lp-section-line" />
          <div className="lp-faq">
            <FaqItem
              q="When do I need to submit my predictions?"
              a="All predictions must be submitted and paid for at least one hour before the first tournament match kicks off. After that moment, new signups close and no one can edit predictions. Once you pay, your picks stay locked."
            />
            <FaqItem
              q="What if I don't fill in every prediction?"
              a="You don't have to fill in every single prediction — but you'll only earn points for the ones you submit. We recommend completing as many as possible to maximise your chances."
            />
            <FaqItem
              q="How does the anytime goalscorer work?"
              a="For each match, you can pick one player you think will score at any point during the game. If they score (including own goals don't count), you earn 2 bonus points."
            />
            <FaqItem
              q="How is the leaderboard updated?"
              a="The leaderboard updates automatically in real time as match results come in from the tournament. You can watch your score change live during matches."
            />
            <FaqItem
              q="Is the payment secure?"
              a="Yes — all payments are processed through Stripe, a PCI Level 1 certified payment processor used by companies like Amazon, Google, and Shopify. We never see or store your card details."
            />
            <FaqItem
              q="Can I get a refund?"
              a="Refunds are available up until predictions lock at tournament kickoff. After that, all entries are final."
            />
            <FaqItem
              q="What happens with playoff teams (TBC spots)?"
              a="Some group spots are still pending playoff results. Once confirmed, we'll update the teams and notify all entrants. Predictions for those matches can be updated until lock-in."
            />
          </div>
        </div>
      </div>

      {/* ── CTA + SIGNUP FORM ────────────────────────────────────── */}
      <div id="lp-signup" className="lp-cta-section">
        <div className="lp-cta-title">Ready to <em>Play?</em></div>
        <div className="lp-cta-sub">
          {submissionClosed
            ? "This entry window has ended."
            : "Join the prediction league in under a minute. Pay after you've made all your predictions."}
        </div>
        {submissionClosed ? (
          <div className="lp-signup-closed">
            <div className="lp-signup-closed-title">Entries closed</div>
            <div className="lp-signup-closed-sub">
              The deadline was <strong style={{ color: COLORS.gold }}>{deadlineLabel}</strong> (one hour before the first match). New signups are not accepted. If you already entered, sign in from your saved session or return on a device where you were logged in.
            </div>
          </div>
        ) : !isSupabaseConfigured ? (
          <div className="lp-signup-form">
            <p className="lp-auth-hint" style={{ marginBottom: "1rem" }}>
              Cloud sync is not configured — your picks are saved in this browser only.
            </p>
            <div className="form-field">
              <label>Full name</label>
              <input className="form-input" placeholder="Your name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-label="Full name" autoComplete="name" />
            </div>
            <div className="form-field">
              <label>Email address</label>
              <input className="form-input" type="email" placeholder="you@example.com" value={form.email} onChange={(e) => set("email", e.target.value)} aria-label="Email address" autoComplete="email" />
            </div>
            <div className="form-field">
              <label>Display username</label>
              <input className="form-input" placeholder="Pick a nickname" value={form.username} onChange={(e) => set("username", e.target.value)} aria-label="Display username" autoComplete="username" />
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 8 }}
              disabled={busy}
              onClick={() => {
                if (form.name && form.email) onLocalComplete({ name: form.name, email: form.email, username: form.username });
              }}
            >
              Start Predicting →
            </button>
            <div style={{ textAlign: "center", marginTop: 8, fontSize: "0.72rem", color: "#555" }}>
              You&apos;ll pay the £10 entry fee after filling in your predictions
            </div>
          </div>
        ) : needsProfileCompletion ? (
          <div className="lp-signup-form">
            <p className="lp-auth-note">Add your display name and username for the leaderboard, then continue.</p>
            <div className="form-field">
              <label>Full name</label>
              <input className="form-input" placeholder="Your name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-label="Full name" autoComplete="name" />
            </div>
            <div className="form-field">
              <label>Display username</label>
              <input className="form-input" placeholder="Pick a nickname" value={form.username} onChange={(e) => set("username", e.target.value)} aria-label="Display username" autoComplete="username" />
            </div>
            <button type="button" className="btn-primary" style={{ marginTop: 8 }} disabled={busy || !form.name?.trim()} onClick={handleProfileOnly}>
              {busy ? "Saving…" : "Continue to predictions →"}
            </button>
          </div>
        ) : (
          <div className="lp-signup-form">
            <div className="lp-auth-tabs" role="tablist" aria-label="Sign up options">
              <button type="button" role="tab" aria-selected={authTab === "signup"} className={`lp-auth-tab${authTab === "signup" ? " active" : ""}`} onClick={() => setAuthTab("signup")}>
                Create account
              </button>
              <button type="button" role="tab" aria-selected={authTab === "signin"} className={`lp-auth-tab${authTab === "signin" ? " active" : ""}`} onClick={() => setAuthTab("signin")}>
                Sign in
              </button>
            </div>

            {authTab === "signup" && (
              <>
                <div className="form-field">
                  <label>Full name</label>
                  <input className="form-input" placeholder="Your name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-label="Full name" autoComplete="name" />
                </div>
                <div className="form-field">
                  <label>Email address</label>
                  <input className="form-input" type="email" placeholder="you@example.com" value={form.email} onChange={(e) => set("email", e.target.value)} aria-label="Email address" autoComplete="email" />
                </div>
                <div className="form-field">
                  <label>Display username</label>
                  <input className="form-input" placeholder="Pick a nickname" value={form.username} onChange={(e) => set("username", e.target.value)} aria-label="Display username" autoComplete="username" />
                </div>
                <div className="form-field">
                  <label>Password</label>
                  <input className="form-input" type="password" placeholder="At least 6 characters" value={form.password} onChange={(e) => set("password", e.target.value)} aria-label="Password" autoComplete="new-password" />
                </div>
                <div className="form-field">
                  <label>Confirm password</label>
                  <input className="form-input" type="password" placeholder="Repeat password" value={form.password2} onChange={(e) => set("password2", e.target.value)} aria-label="Confirm password" autoComplete="new-password" />
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ marginTop: 8 }}
                  disabled={
                    busy ||
                    !form.name?.trim() ||
                    !form.email?.trim() ||
                    !form.password ||
                    form.password.length < 6 ||
                    form.password !== form.password2
                  }
                  onClick={handleSignUp}
                >
                  {busy ? "Creating account…" : "Create account & start predicting →"}
                </button>
                <p className="lp-auth-hint">After sign-up you can save predictions to your account. You&apos;ll pay the £10 entry fee when you&apos;re ready to lock in.</p>
              </>
            )}

            {authTab === "signin" && (
              <>
                <div className="form-field">
                  <label>Email address</label>
                  <input className="form-input" type="email" placeholder="you@example.com" value={form.email} onChange={(e) => set("email", e.target.value)} aria-label="Email address" autoComplete="email" />
                </div>
                <div className="form-field">
                  <label>Password</label>
                  <input className="form-input" type="password" placeholder="Your password" value={form.password} onChange={(e) => set("password", e.target.value)} aria-label="Password" autoComplete="current-password" />
                </div>
                <button type="button" className="btn-primary" style={{ marginTop: 8 }} disabled={busy || !form.email?.trim() || !form.password} onClick={handleSignIn}>
                  {busy ? "Signing in…" : "Sign in →"}
                </button>
                <button type="button" className="lp-auth-link" onClick={handleForgot}>
                  Forgot password?
                </button>
                <p className="lp-auth-hint">We&apos;ll email you a link to set a new password.</p>
              </>
            )}

          </div>
        )}
        <div className="lp-trust">
          <div className="lp-trust-item"><span className="lp-trust-icon">🔒</span> Secure Payments</div>
          <div className="lp-trust-item"><span className="lp-trust-icon">⚡</span> Live Scoring</div>
          <div className="lp-trust-item"><span className="lp-trust-icon">📱</span> Mobile Friendly</div>
          <div className="lp-trust-item"><span className="lp-trust-icon">🏆</span> Real Prizes</div>
        </div>
      </div>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <div className="lp-footer">
        <div className="lp-footer-text">
          WC Predictions 2026 — Not affiliated with FIFA. For entertainment purposes. Must be 18+.
        </div>
      </div>
    </div>
  );
}

function MatchesScreen({ preds, setPreds, results, readOnly }) {
  const [activeGroup, setActiveGroup] = useState("A");
  const groups = Object.keys(TEAMS);
  const groupDone = (g) => {
    const matches = GROUP_MATCHES.filter(m => m.group === g);
    return matches.every(m => {
      const p = preds[`${m.home}-${m.away}`];
      return p && p.home !== "" && p.away !== "";
    });
  };
  const totalDone = groups.filter(g => groupDone(g)).length;

  const setMatchPred = (key, field, val) => {
    if (readOnly) return;
    setPreds(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [field]: val } }));
  };

  const matches = GROUP_MATCHES.filter(m => m.group === activeGroup);

  return (
    <div className="section">
      <div className="section-title">Group Matches</div>
      <div className="section-title-line" />
      <div className="section-sub">Predict score + anytime goalscorer for each match{readOnly ? " (read-only)" : ""}</div>
      <div className="progress-label"><span>Groups completed</span><span>{totalDone}/{groups.length}</span></div>
      <div className="progress-bar"><div className="progress-fill" style={{ width: `${(totalDone / groups.length) * 100}%` }} /></div>
      <div className="group-tabs">
        {groups.map(g => (
          <button key={g} className={`group-tab${activeGroup === g ? " active" : ""}`} onClick={() => setActiveGroup(g)}>
            Group {g} {groupDone(g) ? "✓" : ""}
          </button>
        ))}
      </div>
      {matches.map(m => {
        const key = `${m.home}-${m.away}`;
        const p = preds[key] || {};
        const result = getMatchResultForTeams(results?.matches, m.home, m.away);
        const hasScore = result && result.homeGoals != null && result.awayGoals != null;
        const canScore = result && (result.isFinished || result.isLive) && hasScore;
        const matchPts = canScore ? scoreMatch(p, result) : null;
        return (
          <div key={key} className="card">
            <div className="card-header">
              <span className="group-badge">Group {m.group}</span>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {result?.isLive && <span className="live-badge">● LIVE {result.minute}'</span>}
                {result?.isFinished && <span className="ft-badge">{result.status}</span>}
                {p.home !== undefined && p.away !== undefined && p.home !== "" && p.away !== "" && (
                  <span className="completion-badge">✓ Predicted</span>
                )}
                {canScore && (
                  <span className={`match-pts-pill${matchPts.points === 0 ? " muted" : ""}`} title="Points from this fixture">
                    +{matchPts.points}
                  </span>
                )}
              </div>
            </div>
            <div className="match-row">
              <div className="score-line" role="group" aria-label={`Score prediction for ${m.home} vs ${m.away}`}>
                <div className="score-cluster score-cluster--home">
                  <span className="score-team-inline">
                    <TeamFlag team={m.home} size={24} />
                    <span className="score-inline-name">{m.home}</span>
                  </span>
                  <ScoreInput value={p.home ?? ""} onChange={(v) => setMatchPred(key, "home", v)} label={`${m.home} goals`} disabled={readOnly} />
                </div>
                <span className="vs" aria-hidden="true">
                  vs
                </span>
                <div className="score-cluster score-cluster--away">
                  <span className="score-team-inline">
                    <TeamFlag team={m.away} size={24} />
                    <span className="score-inline-name">{m.away}</span>
                  </span>
                  <ScoreInput value={p.away ?? ""} onChange={(v) => setMatchPred(key, "away", v)} label={`${m.away} goals`} disabled={readOnly} />
                </div>
              </div>
              <div className="scorer-row">
                <span className="scorer-label">⚽ Anytime scorer:</span>
                <select className="styled-select" value={p.scorer || ""} onChange={e => setMatchPred(key, "scorer", e.target.value)} aria-label={`Anytime goalscorer for ${m.home} vs ${m.away}`} disabled={readOnly}>
                  <option value="">— Pick a player —</option>
                  {[m.home, m.away].map(team => {
                    const teamPlayers = PLAYERS[team] || [];
                    if (!teamPlayers.length) return null;
                    return (
                      <optgroup key={team} label={team}>
                        {teamPlayers.map((pl, i) => (
                          <option key={i} value={`${team}|${pl}`}>{pl}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
              <div className="actual-result">
                <div className="actual-result-label">ACTUAL RESULT</div>
                {canScore ? (
                  <>
                    <div className="actual-score-row">
                      <span className="actual-score-val">{result.homeGoals}</span>
                      <span className="actual-score-divider">—</span>
                      <span className="actual-score-val">{result.awayGoals}</span>
                    </div>
                    <span className="match-pts-total-big">+{matchPts.points}</span>
                    {matchPts.breakdown.length > 0 && (
                      <div className="match-pts-earned" style={{ marginTop: 8 }}>
                        <span className="match-pts-detail">
                          {matchPts.breakdown.map(b => `${b.label} +${b.pts}`).join(" · ")}
                        </span>
                      </div>
                    )}
                    {matchPts.points === 0 && result.isFinished && (
                      <div className="match-pts-earned zero">
                        <span style={{ color: "#555", fontSize: "0.75rem" }}>No points earned</span>
                      </div>
                    )}
                  </>
                ) : result?.date ? (
                  <div className="actual-result-pending">
                    {result.isLive || result.isFinished
                      ? "Awaiting score from feed…"
                      : `Scheduled — ${new Date(result.date).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
                  </div>
                ) : (
                  <div className="actual-result-pending">No fixture data yet</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StandingsScreen({ preds, setPreds, readOnly }) {
  const groups = Object.keys(TEAMS);
  const [activeGroup, setActiveGroup] = useState("A");
  const groupPred = preds[`standings_${activeGroup}`] || [];

  const setSlot = (pos, team) => {
    if (readOnly) return;
    const current = [...groupPred];
    const existingIdx = current.indexOf(team);
    if (existingIdx !== -1) current[existingIdx] = null;
    current[pos] = team;
    setPreds(prev => ({ ...prev, [`standings_${activeGroup}`]: current }));
  };

  const teams = TEAMS[activeGroup];
  const placed = groupPred.filter(Boolean);
  const unplaced = teams.filter(t => !placed.includes(t));

  const allGroupsDone = groups.every(g => {
    const p = preds[`standings_${g}`] || [];
    return p.filter(Boolean).length === 4;
  });

  return (
    <div className="section">
      <div className="section-title">Group Standings</div>
      <div className="section-title-line" />
      <div className="section-sub">Predict the final standings for each group{readOnly ? " (read-only)" : ""}</div>
      <div className="group-tabs">
        {groups.map(g => {
          const done = (preds[`standings_${g}`] || []).filter(Boolean).length === 4;
          return (
            <button key={g} className={`group-tab${activeGroup === g ? " active" : ""}`} onClick={() => setActiveGroup(g)}>
              Group {g} {done ? "✓" : ""}
            </button>
          );
        })}
      </div>
      <div className="card">
        <div className="card-header">
          <span className="group-badge">Group {activeGroup} Final Standings</span>
          <span className="tag">Tap team then position</span>
        </div>
        <div style={{ padding: "14px" }} className={readOnly ? "standings-readonly" : ""}>
          <div className="drag-team-pool">
            {teams.map(team => (
              <div key={team} className={`drag-team${placed.includes(team) ? " selected" : ""}`}
                onClick={() => {
                  if (readOnly) return;
                  if (placed.includes(team)) {
                    const idx = groupPred.indexOf(team);
                    const updated = [...groupPred];
                    updated[idx] = null;
                    setPreds(prev => ({ ...prev, [`standings_${activeGroup}`]: updated }));
                  }
                }}>
                <TeamFlag team={team} size={20} />
                <span>{team}</span>
              </div>
            ))}
          </div>
          <div className="standings-grid">
            {[0, 1, 2, 3].map(pos => {
              const team = groupPred[pos];
              return (
                <div key={pos} className={`standing-slot${team ? " filled" : ""}`}
                  onClick={() => {
                    if (readOnly) return;
                    if (!team && unplaced.length > 0) {
                      setSlot(pos, unplaced[0]);
                    }
                  }}>
                  <div className="pos">{["1st","2nd","3rd","4th"][pos]}</div>
                  {team ? (
                    <>
                      <div className="team-flag"><TeamFlag team={team} size={26} /></div>
                      <div className="team-nm">{team}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: "0.7rem", color: "#444" }}>tap to fill</div>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: "0.72rem", color: "#444", marginTop: "8px", fontFamily: "'Noto Sans', sans-serif" }}>
            Tap a team above to deselect. Click an empty slot to place the next unplaced team.
          </p>
        </div>
      </div>
      {allGroupsDone && (
        <div style={{ textAlign: "center", marginTop: "12px" }}>
          <span className="completion-badge" style={{ fontSize: "0.85rem", padding: "6px 16px" }}>
            ✓ All groups predicted
          </span>
        </div>
      )}
    </div>
  );
}

function OutrightsScreen({ preds, setPreds, readOnly }) {
  const set = (k, v) => {
    if (readOnly) return;
    setPreds(prev => ({ ...prev, [k]: v }));
  };

  const outrights = [
    { key: "winner", icon: "🏆", label: "Tournament winner" },
    { key: "runner_up", icon: "🥈", label: "Runner-up" },
    { key: "third", icon: "🥉", label: "3rd place" },
    { key: "golden_boot", icon: "👟", label: "Golden Boot" },
    { key: "golden_glove", icon: "🧤", label: "Golden Glove (GK)" },
    { key: "best_young", icon: "🌟", label: "Best Young Player" },
    { key: "top_scoring_team", icon: "🔥", label: "Highest scoring team", kind: "team" },
    { key: "england_progress", icon: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", label: "How far will England get?", kind: "england" },
    {
      key: "total_goals",
      icon: "⚽",
      label: "Total goals in the tournament",
      kind: "number",
      min: 50,
      max: 250,
      hint: "Every goal in the tournament counts. Also used as the leaderboard tiebreaker when points are level.",
    },
  ];

  const playerKinds = new Set(["golden_boot", "golden_glove", "best_young"]);

  return (
    <div className="section">
      <div className="section-title">Tournament Outrights</div>
      <div className="section-title-line" />
      <div className="section-sub">Who's lifting the trophy? Who's golden?{readOnly ? " (read-only)" : ""}</div>
      <div className="outright-grid">
        {outrights.map(({ key, icon, label, kind, min, max, hint }) => {
          if (kind === "number") {
            return (
              <div key={key} className="outright-card" style={{ gridColumn: "1 / -1" }}>
                <span className="outright-icon">{icon}</span>
                <label>{label}</label>
                {hint && <div className="hint" style={{ fontSize: "0.72rem", color: "#444", marginTop: 6, marginBottom: 10, fontFamily: "'Noto Sans', sans-serif", lineHeight: 1.5 }}>{hint}</div>}
                <NumberStepper value={preds[key] ?? ""} onChange={v => set(key, v)} min={min} max={max} label={label} disabled={readOnly} />
              </div>
            );
          }
          return (
            <div key={key} className="outright-card">
              <span className="outright-icon">{icon}</span>
              <label>{label}</label>
              <select className="styled-select" style={{ width: "100%" }} value={preds[key] || ""} onChange={e => set(key, e.target.value)} aria-label={label} disabled={readOnly}>
                <option value="">— Select —</option>
                {kind === "england"
                  ? ENGLAND_PROGRESS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))
                  : kind === "team" || (!kind && !playerKinds.has(key))
                    ? ALL_TEAMS.filter(t => !t.startsWith("UEFA") && !t.startsWith("IC")).map(t => <option key={t} value={t}>{t}</option>)
                    : Object.entries(PLAYERS).filter(([t]) => !t.startsWith("UEFA") && !t.startsWith("IC")).map(([t, players]) => (
                      <optgroup key={t} label={t}>
                        {players.map((pl, i) => (
                          <option key={i} value={`${t}|${pl}`}>{pl}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RulesScreen() {
  const rules = [
    { icon: "✅", title: "Correct result", pts: "+3 pts", desc: "Predict the right W/D/L outcome" },
    { icon: "🎯", title: "Exact score", pts: "+5 pts", desc: "Nail the exact scoreline" },
    { icon: "⚽", title: "Anytime scorer", pts: "+4 pts", desc: "Your picked player scores at any point" },
    { icon: "📋", title: "Group winner", pts: "+6 pts", desc: "Correctly predict a group winner" },
    { icon: "🥈", title: "Group runner-up", pts: "+4 pts", desc: "Correctly predict 2nd place" },
    { icon: "🏆", title: "Tournament winner", pts: "+15 pts", desc: "You called the champions!" },
    { icon: "👟", title: "Golden Boot", pts: "+10 pts", desc: "Pick the top scorer correctly" },
    { icon: "🔥", title: "Highest scoring team", pts: "+10 pts", desc: "Team with the most goals in the tournament" },
    { icon: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", title: "England progress", pts: "+8 pts", desc: "How far England go — exact stage matched after the tournament" },
    { icon: "⚽", title: "Total tournament goals", pts: "+10 / +5 pts", desc: "Exact total goals, or within ±3 — also breaks ties on the leaderboard" },
  ];

  return (
    <div className="section">
      <div className="section-title">How Scoring Works</div>
      <div className="section-title-line" />
      <div className="section-sub">Points for every correct prediction you make</div>
      <div className="rules-grid">
        {rules.map((r, i) => (
          <div key={i} className="rule-card">
            <div className="rule-icon">{r.icon}</div>
            <h4>{r.title} <span style={{ color: COLORS.accent }}>{r.pts}</span></h4>
            <p>{r.desc}</p>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: "16px" }}>
        <div style={{ padding: "14px" }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, letterSpacing: "1px", textTransform: "uppercase", fontSize: "1rem", color: COLORS.gold, marginBottom: "8px" }}>
            Tiebreaker
          </div>
          <p style={{ fontSize: "0.82rem", color: "#666", lineHeight: 1.6, fontFamily: "'Noto Sans', sans-serif" }}>
            If two players finish on the same points, the one whose total tournament goals prediction is closest to the actual total ranks higher. Enter your total in the Outrights tab.
          </p>
        </div>
      </div>
    </div>
  );
}

function UserPredictionsPanel({ predictions }) {
  const [activeGroup, setActiveGroup] = useState("A");
  const groups = Object.keys(TEAMS);
  const groupMatches = GROUP_MATCHES.filter(m => m.group === activeGroup);
  const preds = predictions || {};

  const outrightSummary = [
    { key: "winner", icon: "🏆", label: "Winner" },
    { key: "runner_up", icon: "🥈", label: "Runner-up" },
    { key: "third", icon: "🥉", label: "3rd place" },
    { key: "golden_boot", icon: "👟", label: "Golden Boot" },
    { key: "golden_glove", icon: "🧤", label: "Golden Glove" },
    { key: "best_young", icon: "🌟", label: "Best Young Player" },
    { key: "top_scoring_team", icon: "🔥", label: "Top Scoring Team" },
    { key: "england_progress", icon: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", label: "England" },
    { key: "total_goals", icon: "⚽", label: "Total Goals" },
  ];

  const formatVal = (v) => {
    if (!v && v !== 0) return null;
    return typeof v === "string" && v.includes("|") ? v.split("|")[1] : String(v);
  };

  return (
    <div className="lb-pred-panel">
      <div className="group-tabs">
        {groups.map(g => (
          <button key={g} className={`group-tab${activeGroup === g ? " active" : ""}`} onClick={e => { e.stopPropagation(); setActiveGroup(g); }}>
            {g}
          </button>
        ))}
      </div>
      <table className="pred-table">
        <tbody>
          {groupMatches.map(m => {
            const key = `${m.home}-${m.away}`;
            const p = preds[key] || {};
            const hasScore = p.home !== undefined && p.home !== "" && p.away !== undefined && p.away !== "";
            const scorer = p.scorer ? formatVal(p.scorer) : null;
            return (
              <tr key={key}>
                <td className="pred-team pred-team--home">
                  <TeamFlag team={m.home} size={14} />
                  <span>{m.home}</span>
                </td>
                <td className="pred-score">{hasScore ? `${p.home}–${p.away}` : "–"}</td>
                <td className="pred-team pred-team--away">
                  <TeamFlag team={m.away} size={14} />
                  <span>{m.away}</span>
                </td>
                <td className="pred-scorer">{scorer || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="pred-outrights">
        {outrightSummary.map(({ key, icon, label }) => {
          const display = formatVal(preds[key]);
          if (!display) return null;
          return (
            <div key={key} className="pred-outright-item">
              <span className="pred-outright-label">{icon} {label}</span>
              <span className="pred-outright-val">{display}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeaderboardScreen({ results, allUsers, currentUserId, submissionClosed }) {
  const [expandedId, setExpandedId] = useState(null);

  const hasResults = results && Object.values(results.matches || {}).some(
    m => m.isFinished || m.isLive
  );

  const scored = allUsers
    .filter(u => u.profile?.name || u.profile?.username)
    .map(u => {
      const s = hasResults
        ? scorePredictions(u.predictions || {}, results)
        : { total: 0, matchPoints: 0, standingsPoints: 0, outrightPoints: 0, statsPoints: 0 };
      const rawGoals = Number(u.predictions?.total_goals);
      const totalGoalsPred = Number.isFinite(rawGoals) && rawGoals >= 50 ? rawGoals : null;
      return {
        id: u.id,
        name: u.profile?.username || u.profile?.name || "Anonymous",
        avatar: (u.profile?.username || u.profile?.name || "??").slice(0, 2).toUpperCase(),
        ...s,
        totalGoalsPred,
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const actualGoals = results?.stats?.totalGoals;
      const dist = (p) => {
        if (p.totalGoalsPred == null || typeof actualGoals !== "number") return Infinity;
        return Math.abs(p.totalGoalsPred - actualGoals);
      };
      const d = dist(a) - dist(b);
      if (d !== 0) return d;
      return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    });

  const entryCount = scored.length;
  const { grossPot, costAmount, prizePot } = getPotBreakdown(entryCount);

  if (!submissionClosed) {
    return (
      <div className="section">
        <div className="section-title">Leaderboard</div>
        <div className="section-title-line" />
        <div className="lb-locked-notice">
          <span className="lb-locked-notice-icon">🔒</span>
          <div className="lb-locked-notice-text">
            <strong style={{ color: COLORS.gold, display: "block", marginBottom: 4 }}>Hidden until entry closes</strong>
            The leaderboard and all participants' predictions will be revealed once the entry deadline passes. This keeps the competition fair — no one can see others' picks while entries are still open.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-title">Leaderboard</div>
      <div className="section-title-line" />
      <div className="section-sub">
        Live standings — updated after each match. Ties on points are broken by who is closest to the actual total tournament goals.
        {results?.hasLive && <span className="live-badge" style={{ marginLeft: 8 }}>● LIVE</span>}
      </div>

      {!hasResults && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ padding: 14, textAlign: "center" }}>
            <span style={{ fontSize: "0.82rem", color: "#666" }}>
              {isApiFootballConfigured
                ? "No match results yet — scores will update live once the tournament kicks off"
                : "Connect API-Football to enable live scoring (see .env.example)"}
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ padding: "14px" }}>
          {scored.length === 0 ? (
            <div style={{ padding: "12px 0", textAlign: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "#444" }}>No entrants yet</span>
            </div>
          ) : (
            scored.map((p, i) => {
              const user = allUsers.find(u => u.id === p.id);
              const isExpanded = expandedId === p.id;
              return (
                <div key={p.id}>
                  <div
                    className={`lb-row clickable${p.id === currentUserId ? " lb-you" : ""}${isExpanded ? " expanded" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                    title="Click to view predictions"
                  >
                    <span className={`lb-rank${i === 0 ? " top1" : i === 1 ? " top2" : i === 2 ? " top3" : ""}`}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                    </span>
                    <div className="lb-avatar">{p.avatar}</div>
                    <div style={{ flex: 1 }}>
                      <div className="lb-name">{p.name}</div>
                      {hasResults && (
                        <div className="lb-breakdown">
                          <span className="lb-cat">Matches: <span>{p.matchPoints}</span></span>
                          <span className="lb-cat">Groups: <span>{p.standingsPoints}</span></span>
                          <span className="lb-cat">Outrights: <span>{p.outrightPoints}</span></span>
                        </div>
                      )}
                    </div>
                    <div className="lb-pts">{p.total}pts</div>
                    <span className={`lb-chevron${isExpanded ? " open" : ""}`}>▼</span>
                  </div>
                  {isExpanded && user && (
                    <UserPredictionsPanel predictions={user.predictions} />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="group-badge">Prize Pool</span></div>
        <div style={{ padding: "14px" }}>
          <div style={{ textAlign: "center", margin: "8px 0" }}>
            <div style={{ fontSize: "0.72rem", color: "#666", fontFamily: "'Barlow', sans-serif", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700 }}>
              Current pot ({entryCount} {entryCount === 1 ? "entry" : "entries"})
            </div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: "2.6rem", color: COLORS.gold }}>
              £{prizePot.toFixed(2)}
            </div>
            {COST_PERCENT > 0 && (
              <div style={{ marginTop: 6, fontSize: "0.75rem", color: "#666", fontFamily: "'Noto Sans', sans-serif" }}>
                Gross £{grossPot.toFixed(2)} − costs ({COST_PERCENT}%) £{costAmount.toFixed(2)}
              </div>
            )}
          </div>
          <div className="prize-breakdown">
            <div className="prize-row"><span>🥇 1st</span><span>£{(prizePot * 0.6).toFixed(2)}</span></div>
            <div className="prize-row"><span>🥈 2nd</span><span>£{(prizePot * 0.25).toFixed(2)}</span></div>
            <div className="prize-row"><span>🥉 3rd</span><span>£{(prizePot * 0.1).toFixed(2)}</span></div>
            <div className="prize-row"><span>👟 Golden Boot closest</span><span>£{(prizePot * 0.05).toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      {hasResults && results.fetchedAt && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <span style={{ fontSize: "0.68rem", color: "#444" }}>
            Results updated {new Date(results.fetchedAt).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}

function SubmitScreen({ preds, profile, onPay, paymentLoading, submissionClosed }) {
  const totalMatches = GROUP_MATCHES.length;
  const matchesDone = GROUP_MATCHES.filter(m => {
    const p = preds[`${m.home}-${m.away}`];
    return p && p.home !== "" && p.away !== "";
  }).length;

  const totalGroups = Object.keys(TEAMS).length;
  const groupsDone = Object.keys(TEAMS).filter(g => {
    const s = preds[`standings_${g}`];
    return s && s.length >= 2 && s[0] && s[1];
  }).length;

  const outrightKeys = ["winner", "runner_up", "third", "golden_boot", "golden_glove", "best_young", "top_scoring_team", "england_progress", "total_goals"];
  const outrightsDone = outrightKeys.filter((k) => {
    if (k === "total_goals") return preds[k] !== undefined && preds[k] !== "" && Number(preds[k]) >= 50;
    return preds[k] && preds[k] !== "";
  }).length;

  const isPaid = profile?.paid;
  const isLocked = profile?.locked;

  const sections = [
    { label: "Match Predictions", done: matchesDone, total: totalMatches },
    { label: "Group Standings", done: groupsDone, total: totalGroups },
    { label: "Outrights", done: outrightsDone, total: outrightKeys.length },
  ];

  const overallPct = Math.round(
    ((matchesDone + groupsDone + outrightsDone) /
      (totalMatches + totalGroups + outrightKeys.length)) * 100,
  );

  return (
    <div className="section">
      <div className="section-title">Submit & Pay</div>
      <div className="section-title-line" />
      <div className="section-sub">Review your predictions and lock them in with a £10 payment</div>

      <div className="submit-card">
        {isPaid ? (
          <div className="submit-paid">
            <div className="submit-paid-icon">✅</div>
            <div className="submit-paid-title">Payment Confirmed</div>
            <div className="submit-paid-sub">
              Your predictions are locked in. Good luck!
            </div>
          </div>
        ) : submissionClosed ? (
          <div className="submit-paid" style={{ borderColor: "rgba(229,115,115,0.35)", background: "rgba(229,115,115,0.06)" }}>
            <div className="submit-paid-title" style={{ color: "#e57373" }}>Submissions closed</div>
            <div className="submit-paid-sub">
              The entry deadline has passed. New payments are not accepted. If you entered before the deadline but did not pay, contact the organiser.
            </div>
          </div>
        ) : (
          <>
            <div className="submit-title">Prediction Summary</div>
            <div className="submit-checklist">
              {sections.map(s => {
                const pct = Math.round((s.done / s.total) * 100);
                const cls = pct === 100 ? "done" : pct > 0 ? "partial" : "";
                return (
                  <div key={s.label} className={`submit-check-row ${cls}`}>
                    <span className="submit-check-icon">
                      {pct === 100 ? "✓" : pct > 0 ? "◐" : "○"}
                    </span>
                    <span className="submit-check-label">{s.label}</span>
                    <span className="submit-check-pct">
                      {s.done}/{s.total}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="progress-label">
              <span>Overall completion</span>
              <span>{overallPct}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${overallPct}%` }} />
            </div>

            <div className="entry-fee-box" style={{ marginTop: "1.2rem" }}>
              <span>Entry fee</span>
              <strong>£{ENTRY_FEE_GBP.toFixed(2)}</strong>
            </div>

            <div className="prize-breakdown" style={{ marginBottom: "1rem" }}>
              <div className="prize-row"><span>🥇 1st place</span><span>60% of prize pot</span></div>
              <div className="prize-row"><span>🥈 2nd place</span><span>25% of prize pot</span></div>
              <div className="prize-row"><span>🥉 3rd place</span><span>10% of prize pot</span></div>
              <div className="prize-row"><span>👟 Closest golden boot</span><span>5% of prize pot</span></div>
            </div>
            {COST_PERCENT > 0 && (
              <div style={{ textAlign: "center", marginBottom: 12, fontSize: "0.72rem", color: "#666" }}>
                {COST_PERCENT}% is deducted from the gross pot for costs before prizes are allocated.
              </div>
            )}

            <button
              className="btn-pay"
              onClick={onPay}
              disabled={paymentLoading || matchesDone === 0}
            >
              {paymentLoading ? (
                "Redirecting to Stripe…"
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                    <line x1="1" y1="10" x2="23" y2="10" />
                  </svg>
                  Lock In & Pay £10
                </>
              )}
            </button>

            {matchesDone === 0 && (
              <div style={{ textAlign: "center", marginTop: 8, fontSize: "0.75rem", color: "#666" }}>
                Fill in at least some match predictions before paying
              </div>
            )}

            <div style={{ textAlign: "center", marginTop: 12, fontSize: "0.68rem", color: "#444" }}>
              Secure payment via Stripe — you can edit predictions until you pay
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("signup");
  const [preds, setPreds] = useState({});
  const [toast, setToast] = useState(null);
  const [results, setResults] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [deadlineTick, setDeadlineTick] = useState(0);
  const [needsProfileCompletion, setNeedsProfileCompletion] = useState(false);
  /** When true, initial auth bootstrap must not call setScreen("signup") — it can race after sign-in and undo navigation. */
  const suppressAuthBootstrapSignupRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setDeadlineTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const deadlineMs = useMemo(() => getSubmissionDeadlineMs(results), [results]);
  const firstKickoffMs = useMemo(() => getFirstKickoffMs(results), [results]);
  void deadlineTick;
  const now = Date.now();
  const submissionClosed = now >= deadlineMs;
  const msUntilDeadline = deadlineMs - now;
  const countdownLabel = submissionClosed ? null : formatCountdown(msUntilDeadline);
  const deadlineLabel = formatDeadlineLocal(deadlineMs);
  const firstKickoffLabel = new Date(firstKickoffMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const predictionsReadOnly = Boolean(profile?.locked || submissionClosed);

  // Redirect off leaderboard if entry hasn't closed yet (tab is hidden, but guard against direct state)
  useEffect(() => {
    if (screen === "leaderboard" && !submissionClosed) {
      setScreen("matches");
    }
  }, [screen, submissionClosed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const local = JSON.parse(raw);
          if (local?.predictions && typeof local.predictions === "object" && !cancelled) {
            setPreds(local.predictions);
          }
          if (local?.entered && !cancelled) {
            setScreen(local.screen || "matches");
          }
        }
        if (isSupabaseConfigured && supabase) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user) {
            let prof = await fetchProfile();
            if (!prof) {
              const ensured = await ensureProfileFromAuthSession();
              if (ensured.ok && ensured.profile) prof = ensured.profile;
            }
            if (!cancelled && prof) setProfile(prof);
            if (!cancelled && !prof) {
              setNeedsProfileCompletion(true);
              // Do not send the user back to signup if they just signed in while this
              // slow bootstrap was in flight — that produced a successful token but no redirect.
              if (!suppressAuthBootstrapSignupRef.current) {
                setScreen("signup");
              }
            } else if (!cancelled && prof?.name && prof?.email) {
              setScreen((s) => (s === "signup" ? "matches" : s));
            }
            const row = await fetchPredictionsRow();
            if (!cancelled && row?.predictions && typeof row.predictions === "object") {
              setPreds(row.predictions);
            }
          }
        }
      } catch (e) {
        console.warn("Load predictions:", e);
      } finally {
        if (!cancelled) suppressAuthBootstrapSignupRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    if (paymentStatus === "success") {
      showToast("Payment successful — predictions locked!");
      setScreen("submit");
      (async () => {
        if (isSupabaseConfigured) {
          const prof = await fetchProfile();
          if (prof) setProfile(prof);
        }
      })();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (paymentStatus === "cancelled") {
      showToast("Payment cancelled — you can try again");
      setScreen("submit");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!isApiFootballConfigured) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchAllResults();
        if (!cancelled) setResults(data);
      } catch (e) {
        console.warn("Results fetch:", e);
      }
    };
    poll();
    const id = setInterval(poll, hasLiveMatches() ? 60_000 : 300_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const load = async () => {
      try {
        const session = await ensureSupabaseSession();
        if (!cancelled && session?.user?.id) setCurrentUserId(session.user.id);
        const users = await fetchAllPredictions();
        if (!cancelled) setAllUsers(users);
      } catch (e) {
        console.warn("Leaderboard load:", e);
      }
    };
    load();
    const id = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setCurrentUserId(session.user.id);
        let prof = await fetchProfile();
        if (!prof) {
          const ensured = await ensureProfileFromAuthSession();
          if (ensured.ok && ensured.profile) prof = ensured.profile;
        }
        setProfile(prof);
        // Only update completion flag — navigation is handled by the explicit
        // sign-in / sign-up handlers. Forcing setScreen here races with those
        // handlers and can undo a successful redirect.
        setNeedsProfileCompletion(!prof?.name || !prof?.email);
      } else {
        // Session ended (sign-out / expiry) — return to signup screen
        setCurrentUserId(null);
        setProfile(null);
        setNeedsProfileCompletion(false);
        if (event === "SIGNED_OUT") {
          setScreen("signup");
        }
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const persistLocal = (nextPreds, nextScreen) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        predictions: nextPreds,
        screen: nextScreen,
        entered: nextScreen !== "signup",
      }),
    );
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const finalizeEntryAfterAuth = async (form) => {
    if (Date.now() >= getSubmissionDeadlineMs(results)) {
      showToast("Submissions are closed — new entries are not accepted.");
      return;
    }
    setScreen("matches");
    persistLocal(preds, "matches");
    if (!isSupabaseConfigured) return;
    const profResult = await upsertProfile({
      name: form.name,
      email: form.email,
      username: form.username || `user_${Date.now()}`,
    });
    if (!profResult.ok) showToast(`Profile sync: ${profResult.error || "unavailable"}`);
    const r = await upsertPredictions(preds, {
      name: form.name,
      email: form.email,
      username: form.username || "",
    });
    if (!r.ok) showToast(`Predictions sync: ${r.error || "unavailable"}`);
    const prof = await fetchProfile();
    if (prof) setProfile(prof);
    sendEmail(form.email, "welcome", { name: form.name }).catch(() => {});
  };

  const handleLocalOnlyComplete = (form) => {
    if (Date.now() >= getSubmissionDeadlineMs(results)) {
      showToast("Submissions are closed — new entries are not accepted.");
      return;
    }
    setScreen("matches");
    persistLocal(preds, "matches");
    showToast("Saved locally — add Supabase env vars to sync to the cloud.");
  };

  const handlePasswordSignUp = async (form) => {
    const r = await signUpWithPassword({
      email: form.email,
      password: form.password,
      name: form.name,
      username: form.username,
    });
    if (!r.ok) {
      if (r.errorCode === "user_already_exists") {
        showToast(
          "That email is already registered for sign-in (Supabase auth). Your league profile can be empty — use Sign in and we will create or restore your profile.",
        );
        // Signal the SignupScreen to flip to the sign-in tab
        return { switchToSignIn: true };
      }
      showToast(r.error);
      return;
    }
    if (r.session) {
      suppressAuthBootstrapSignupRef.current = true;
      await finalizeEntryAfterAuth(form);
      setNeedsProfileCompletion(false);
    } else {
      showToast(
        "Check your email to confirm your account, then sign in below. Your league profile is created when your account is created (server-side).",
      );
    }
  };

  const handlePasswordSignIn = async (email, password) => {
    const r = await signInWithPassword({ email, password });
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    suppressAuthBootstrapSignupRef.current = true;
    // Navigate immediately so a slow profiles / wc_predictions fetch cannot block the UI
    setScreen("matches");
    persistLocal(preds, "matches");
    try {
      const row = await fetchPredictionsRow();
      if (row?.predictions && typeof row.predictions === "object") {
        setPreds(row.predictions);
        persistLocal(row.predictions, "matches");
      }
      const ensured = await ensureProfileFromAuthSession();
      if (ensured.ok && ensured.profile) {
        setProfile(ensured.profile);
        const incomplete = !ensured.profile.name || !ensured.profile.email;
        setNeedsProfileCompletion(incomplete);
        if (ensured.created) {
          showToast("Your account had no league profile row — we created one from your sign-in email.");
        } else if (incomplete) {
          showToast("Signed in — please complete your profile to submit predictions.");
        }
      } else {
        setProfile(null);
        setNeedsProfileCompletion(true);
        showToast(
          ensured.error
            ? `Signed in — profile could not be saved: ${ensured.error}`
            : "Signed in — please complete your profile to submit predictions.",
        );
      }
    } catch (e) {
      console.warn("After sign-in:", e);
      setNeedsProfileCompletion(true);
      showToast("Signed in — please refresh if your predictions do not appear.");
    }
  };

  const handleCompleteProfile = async ({ name, username }) => {
    const session = await ensureSupabaseSession();
    if (!session?.user?.email) {
      showToast("Not signed in");
      return;
    }
    if (Date.now() >= getSubmissionDeadlineMs(results)) {
      showToast("Submissions are closed.");
      return;
    }
    const profResult = await upsertProfile({
      name,
      email: session.user.email,
      username: username || `user_${Date.now()}`,
    });
    if (!profResult.ok) {
      showToast(profResult.error);
      return;
    }
    const r = await upsertPredictions(preds, {
      name,
      email: session.user.email,
      username: username || "",
    });
    if (!r.ok) showToast(`Predictions: ${r.error}`);
    const prof = await fetchProfile();
    if (prof) setProfile(prof);
    setNeedsProfileCompletion(false);
    setScreen("matches");
    persistLocal(preds, "matches");
    sendEmail(session.user.email, "welcome", { name }).catch(() => {});
  };

  const handleForgotPassword = async (email) => {
    const r = await requestPasswordReset(email);
    if (!r.ok) showToast(r.error);
    else showToast("Check your email for the password reset link.");
  };

  const handlePayment = async () => {
    if (Date.now() >= getSubmissionDeadlineMs(results)) {
      showToast("Submissions are closed — payment is no longer available.");
      return;
    }
    setPaymentLoading(true);
    try {
      await handleSave();
      const result = await createCheckoutSession();
      if (result.ok && result.url) {
        window.location.href = result.url;
        return;
      }
      if (result.paid) {
        showToast("Already paid — predictions are locked!");
        const prof = await fetchProfile();
        if (prof) setProfile(prof);
      } else {
        showToast(result.error || "Payment setup failed — try again");
      }
    } catch (e) {
      console.error("Payment error:", e);
      showToast("Payment failed — please try again");
    } finally {
      setPaymentLoading(false);
    }
  };

  const tabs = screen !== "signup" ? [
    { id: "matches", label: "Matches" },
    { id: "standings", label: "Standings" },
    { id: "outrights", label: "Outrights" },
    { id: "submit", label: profile?.paid ? "✓ Paid" : "Submit" },
    ...(submissionClosed ? [{ id: "leaderboard", label: "Leaderboard" }] : []),
    { id: "rules", label: "Rules" },
  ] : [];

  const handleSignOut = async () => {
    localStorage.removeItem(STORAGE_KEY);
    try {
      if (supabase) await supabase.auth.signOut();
    } catch (e) {
      console.warn("Sign out:", e);
    } finally {
      setPreds({});
      setProfile(null);
      setAllUsers([]);
      setCurrentUserId(null);
      setResults(null);
      setNeedsProfileCompletion(false);
      setScreen("signup");
    }
  };

  const handleSave = async () => {
    if (profile?.locked || Date.now() >= getSubmissionDeadlineMs(results)) {
      showToast("Predictions are locked — no changes can be saved.");
      return;
    }
    persistLocal(preds, screen);
    if (!isSupabaseConfigured) {
      showToast("Predictions saved locally!");
      return;
    }
    const r = await upsertPredictions(preds, {});
    if (r.ok) showToast("Predictions saved!");
    else showToast(`Saved locally — sync failed: ${r.error}`);
  };

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {screen !== "signup" && (
          <div className="hero">
            <div className="hero-pattern" />
            <div className="hero-inner">
              <div className="hero-eyebrow">FIFA World Cup</div>
              <div className="hero-26">
                <span>2</span>
                <span className="hero-26-gold">6</span>
              </div>
              <div className="hero-title-row">
                <div className="hero-weare">WE ARE <em>26</em> — Prediction League</div>
              </div>
              <div className="hero-tags">
                <span className="hero-tag">USA · Canada · Mexico</span>
                <span className="hero-tag">June – July 2026</span>
                <span className="hero-tag">48 Teams · 12 Groups · 104 Matches</span>
              </div>
            </div>
            <div className="hero-divider" />
          </div>
        )}

        {screen !== "signup" && (
          <nav className="nav" aria-label="Prediction sections">
            <div className="nav-tabs-scroll" role="tablist">
              {tabs.map(t => (
                <button key={t.id} type="button" role="tab" aria-selected={screen === t.id} className={`nav-btn${screen === t.id ? " active" : ""}`} onClick={() => setScreen(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <button type="button" className="nav-signout" onClick={handleSignOut} aria-label="Sign out">
              Sign out
            </button>
          </nav>
        )}

        {screen === "signup" && (
          <SignupScreen
            needsProfileCompletion={needsProfileCompletion}
            onCompleteProfile={handleCompleteProfile}
            onPasswordSignUp={handlePasswordSignUp}
            onPasswordSignIn={handlePasswordSignIn}
            onForgotPassword={handleForgotPassword}
            onLocalComplete={handleLocalOnlyComplete}
            submissionClosed={submissionClosed}
            countdownLabel={countdownLabel}
            deadlineLabel={deadlineLabel}
            firstKickoffLabel={firstKickoffLabel}
          />
        )}

        {screen !== "signup" && (
          <div className={`deadline-banner${submissionClosed ? " closed" : ""}`} role="status">
            {submissionClosed ? (
              <>
                <strong>Submissions closed</strong> — predictions are locked (deadline was {deadlineLabel})
              </>
            ) : (
              <>
                <strong>Time to enter:</strong> {countdownLabel} · deadline {deadlineLabel} · first kick-off {firstKickoffLabel}
              </>
            )}
          </div>
        )}

        {predictionsReadOnly && ["matches", "standings", "outrights"].includes(screen) && (
          <div className="section" style={{ paddingBottom: 0 }}>
            <div className="locked-banner">
              {profile?.locked
                ? "🔒 Your predictions are locked — payment confirmed"
                : "🔒 Submissions are closed — the entry deadline has passed; predictions can no longer be edited"}
            </div>
          </div>
        )}

        {screen === "matches" && <MatchesScreen preds={preds} setPreds={predictionsReadOnly ? () => {} : setPreds} results={results} readOnly={predictionsReadOnly} />}
        {screen === "standings" && <StandingsScreen preds={preds} setPreds={predictionsReadOnly ? () => {} : setPreds} readOnly={predictionsReadOnly} />}
        {screen === "outrights" && <OutrightsScreen preds={preds} setPreds={predictionsReadOnly ? () => {} : setPreds} readOnly={predictionsReadOnly} />}
        {screen === "submit" && <SubmitScreen preds={preds} profile={profile} onPay={handlePayment} paymentLoading={paymentLoading} submissionClosed={submissionClosed} />}
        {screen === "leaderboard" && <LeaderboardScreen results={results} allUsers={allUsers} currentUserId={currentUserId} submissionClosed={submissionClosed} />}
        {screen === "rules" && <RulesScreen />}

        {screen !== "signup" && screen !== "leaderboard" && screen !== "rules" && screen !== "submit" && !predictionsReadOnly && (
          <div style={{ padding: "0 1.5rem", marginTop: "8px" }}>
            <button className="btn-primary" onClick={handleSave}>Save Predictions</button>
          </div>
        )}

        {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      </div>
    </>
  );
}
