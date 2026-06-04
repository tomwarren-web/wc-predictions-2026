# Player List Update - Protected Selections

Updated `src/data/players.js` from the official squad comparison while preserving exact player strings already saved in predictions.

## Database Read Summary

- match_predictions rows read: 0
- outright_predictions rows read: 0
- wc_predictions rows read: 8
- unique protected player values: 198

## Update Summary

- teams updated: 48
- protected removed players retained: 36
- protected players appended because missing from generated list: 0
- total player options before: 1248
- total player options after: 1284

## Per-Team Counts

- Mexico: 26 -> 27; official adds 6; unprotected removes 5; protected retained 1
- South Africa: 26 -> 26; official adds 11; unprotected removes 11; protected retained 0
- South Korea: 26 -> 27; official adds 10; unprotected removes 9; protected retained 1
- Czech Republic: 26 -> 26; official adds 7; unprotected removes 7; protected retained 0
- Canada: 26 -> 27; official adds 6; unprotected removes 5; protected retained 1
- Bosnia-Herzegovina: 26 -> 26; official adds 1; unprotected removes 1; protected retained 0
- Qatar: 26 -> 26; official adds 8; unprotected removes 8; protected retained 0
- Switzerland: 26 -> 28; official adds 8; unprotected removes 6; protected retained 2
- Brazil: 26 -> 27; official adds 9; unprotected removes 8; protected retained 1
- Morocco: 26 -> 29; official adds 13; unprotected removes 10; protected retained 3
- Haiti: 26 -> 26; official adds 14; unprotected removes 14; protected retained 0
- Scotland: 26 -> 26; official adds 9; unprotected removes 9; protected retained 0
- USA: 26 -> 27; official adds 10; unprotected removes 9; protected retained 1
- Paraguay: 26 -> 27; official adds 11; unprotected removes 10; protected retained 1
- Australia: 26 -> 27; official adds 14; unprotected removes 13; protected retained 1
- Turkey: 26 -> 29; official adds 6; unprotected removes 3; protected retained 3
- Germany: 26 -> 26; official adds 9; unprotected removes 9; protected retained 0
- Curaçao: 26 -> 26; official adds 12; unprotected removes 12; protected retained 0
- Ivory Coast: 26 -> 28; official adds 10; unprotected removes 8; protected retained 2
- Ecuador: 26 -> 26; official adds 8; unprotected removes 8; protected retained 0
- Netherlands: 26 -> 26; official adds 10; unprotected removes 10; protected retained 0
- Japan: 26 -> 28; official adds 10; unprotected removes 8; protected retained 2
- Sweden: 26 -> 26; official adds 1; unprotected removes 1; protected retained 0
- Tunisia: 26 -> 26; official adds 18; unprotected removes 18; protected retained 0
- Belgium: 26 -> 27; official adds 10; unprotected removes 9; protected retained 1
- Egypt: 26 -> 27; official adds 16; unprotected removes 15; protected retained 1
- Iran: 26 -> 27; official adds 12; unprotected removes 11; protected retained 1
- New Zealand: 26 -> 26; official adds 5; unprotected removes 5; protected retained 0
- Spain: 26 -> 28; official adds 8; unprotected removes 6; protected retained 2
- Cape Verde: 26 -> 29; official adds 14; unprotected removes 11; protected retained 3
- Saudi Arabia: 26 -> 28; official adds 11; unprotected removes 9; protected retained 2
- Uruguay: 26 -> 26; official adds 7; unprotected removes 7; protected retained 0
- France: 26 -> 27; official adds 9; unprotected removes 8; protected retained 1
- Senegal: 26 -> 26; official adds 9; unprotected removes 9; protected retained 0
- Iraq: 26 -> 26; official adds 11; unprotected removes 11; protected retained 0
- Norway: 26 -> 26; official adds 7; unprotected removes 7; protected retained 0
- Argentina: 26 -> 26; official adds 4; unprotected removes 4; protected retained 0
- Algeria: 26 -> 28; official adds 13; unprotected removes 11; protected retained 2
- Austria: 26 -> 27; official adds 8; unprotected removes 7; protected retained 1
- Jordan: 26 -> 26; official adds 12; unprotected removes 12; protected retained 0
- Portugal: 26 -> 26; official adds 6; unprotected removes 6; protected retained 0
- DR Congo: 26 -> 26; official adds 7; unprotected removes 7; protected retained 0
- Uzbekistan: 26 -> 26; official adds 7; unprotected removes 7; protected retained 0
- Colombia: 26 -> 27; official adds 9; unprotected removes 8; protected retained 1
- England: 26 -> 27; official adds 11; unprotected removes 10; protected retained 1
- Croatia: 26 -> 26; official adds 9; unprotected removes 9; protected retained 0
- Ghana: 26 -> 27; official adds 15; unprotected removes 14; protected retained 1
- Panama: 26 -> 26; official adds 5; unprotected removes 5; protected retained 0

## Protected Removed Players Retained

- Algeria|Andy Delort (1 selections; wc_predictions.match.scorer)
- Algeria|Said Benrahma (2 selections; wc_predictions.match.scorer)
- Australia|Riley McGree (1 selections; wc_predictions.match.scorer)
- Austria|Junior Adamu (1 selections; wc_predictions.match.scorer)
- Belgium|Lois Openda (1 selections; wc_predictions.match.scorer)
- Brazil|Rodrygo (1 selections; wc_predictions.match.scorer)
- Canada|Junior Hoilett (2 selections; wc_predictions.match.scorer)
- Cape Verde|Julio Tavares (1 selections; wc_predictions.match.scorer)
- Cape Verde|Pico (1 selections; wc_predictions.match.scorer)
- Cape Verde|Roberto Lopes (1 selections; wc_predictions.match.scorer)
- Colombia|Jhon Duran (5 selections; wc_predictions.match.scorer)
- Egypt|Marwan Attia (1 selections; wc_predictions.match.scorer)
- England|Phil Foden (1 selections; wc_predictions.match.scorer)
- France|Antoine Griezmann (1 selections; wc_predictions.match.scorer)
- Ghana|Mohammed Kudus (1 selections; wc_predictions.match.scorer)
- Iran|Ahmad Noorollahi (1 selections; wc_predictions.match.scorer)
- Ivory Coast|Karim Konate (2 selections; wc_predictions.match.scorer)
- Ivory Coast|Sebastien Haller (3 selections; wc_predictions.match.scorer)
- Japan|Hidemasa Morita (1 selections; wc_predictions.match.scorer)
- Japan|Kaoru Mitoma (2 selections; wc_predictions.match.scorer)
- Mexico|Ramon Juarez (1 selections; wc_predictions.golden_glove)
- Morocco|Amine Adli (1 selections; wc_predictions.match.scorer)
- Morocco|Hakim Ziyech (4 selections; wc_predictions.match.scorer)
- Morocco|Youssef En-Nesyri (1 selections; wc_predictions.match.scorer)
- Paraguay|Mathias Villasanti (1 selections; wc_predictions.match.scorer)
- Saudi Arabia|Abdullah Otayf (1 selections; wc_predictions.match.scorer)
- Saudi Arabia|Hattan Bahebri (1 selections; wc_predictions.match.scorer)
- South Korea|Kim Young-gwon (1 selections; wc_predictions.match.scorer)
- Spain|Ayoze Perez (1 selections; wc_predictions.match.scorer)
- Spain|Dani Carvajal (1 selections; wc_predictions.match.scorer)
- Switzerland|Andi Zeqiri (1 selections; wc_predictions.match.scorer)
- Switzerland|Fabian Schar (1 selections; wc_predictions.match.scorer)
- Turkey|Cengiz Under (2 selections; wc_predictions.match.scorer)
- Turkey|Cenk Tosun (1 selections; wc_predictions.match.scorer)
- Turkey|Semih Kilicsoy (2 selections; wc_predictions.match.scorer)
- USA|Josh Sargent (1 selections; wc_predictions.match.scorer)

## Protected Players Appended Because Missing

None
