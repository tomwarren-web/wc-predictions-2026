# Official FIFA Squad Comparison - 3 June 2026

Source of truth: FIFA media release, 2 June 2026, linking to `SquadLists-English.pdf`; PDF version: Wednesday, 3 June 2026, 11:30 UTC, Version 1.

Compared against `src/data/players.js`. The diff normalises accents, punctuation, `Jr`/`Junior`, common first-name omissions, and first-name/surname order before deciding whether a player is already represented in the project list.

## Summary

- Official teams parsed: 48
- Project teams parsed: 48
- Official players parsed: 1248
- Project players parsed: 1248
- Players already represented after normalisation: 802
- Official players missing from project: 446
- Project players not in official squads: 446
- Nations already complete: 0
- Nations needing changes: 48

## Nations Already Complete

None

## Per-Nation Diff

### Mexico

Matched: 20/26

Add from official squad: Erik Lira, Alvaro Fidalgo, Carlos Acevedo, Armando Gonzalez, Guillermo Martinez, Brian Gutierrez

Remove/not in official squad: Alex Padilla, Julian Araujo, Ramon Juarez, Carlos Rodriguez, Erick Sanchez, Marcel Ruiz

### South Africa

Matched: 15/26

Add from official squad: Thabang Matuludi, Khulumani Ndamane, Tshepang Moremi, Thapelo Maseko, Mbekezeli Mbokazi, Sipho Chaine, Samukelo Kabini, Ime Okon, Olwethu Makhanya, Kamogelo Sebelebele, Bradley Cross

Remove/not in official squad: Veli Mothwa, Mothobi Mvala, Thapelo Morena, Grant Kekana, Siyanda Xulu, Terrence Mashego, Bathusi Aubaas, Percy Tau, Bongokuhle Hlongwane, Elias Mokwana, Monnapule Saleng

### South Korea

Matched: 16/26

Add from official squad: Hanbeom Lee, Gihyuk Lee, Taehyeon Kim, Taeseok Lee, Wije Cho, Jinseob Park, Jens Castrop, Jingyu Kim, Jisung Eom, Donggyeong Lee

Remove/not in official squad: Kim Young-gwon, Kwon Kyung-won, Lee Ki-je, Park Jin-seop, Cho Yu-min, Jeong Seung-hyun, Hong Hyun-seok, Jeong Woo-yeong, Joo Min-kyu, Um Won-sang

Normalised matches with different spelling/order: Youngwoo Seol ~= Seol Young-woo, Hyeonwoo Jo ~= Jo Hyeon-woo, Hyunjun Yang ~= Yang Hyun-jun, Kangin Lee ~= Lee Kang-in, Hyeongyu Oh ~= Oh Hyeon-gyu, Junho Bae ~= Bae Jun-ho, Moonhwan Kim ~= Kim Moon-hwan, Bumkeun Song ~= Song Bum-keun, Heechan Hwang ~= Hwang Hee-chan, Jaesung Lee ~= Lee Jae-sung, Guesung Cho ~= Cho Gue-sung, Seungho Paik ~= Paik Seung-ho, ... plus 4 more

### Czech Republic

Matched: 19/26

Add from official squad: Stepan Chaloupek, Vladimir Darida, Lukas Cerv, Lukas Hornicek, Alexandr Sojka, Hugo Sochurek, Denis Visinsky

Remove/not in official squad: Antonin Kinsky, Martin Vitik, Alex Kral, Adam Karabec, Ondrej Lingr, Antonin Barak, Vaclav Cerny

### Canada

Matched: 20/26

Add from official squad: Ale Jones, Owen Goodman, Niko Sigur, Promise David, Nathan Saliba, Marcelo Flores

Remove/not in official squad: Tom McGill, Kamal Miller, Sam Adekugbe, Samuel Piette, Junior Hoilett, Theo Bair

### Bosnia-Herzegovina

Matched: 25/26

Add from official squad: Mladen Jurkas

Remove/not in official squad: Osman Hadzikic

### Qatar

Matched: 18/26

Add from official squad: Mahmoud Abunada, Issa Laye, Ahmed Alaaeldin, Ayoub Aloui, Homam Ahmed, Tahsin Jamshid, Alhashmi Alhussein, Mohamed Manai

Remove/not in official squad: Shehab Elleithy, Tarek Salman, Bassam Al-Rawi, Homam Al-Amin, Mohammed Waad, Ali Asad, Ahmed Alaa, Tahsin Mohammed

Normalised matches with different spelling/order: Ahmed Fathy ~= Ahmed Fathi

### Switzerland

Matched: 18/26

Add from official squad: Miro Muheim, Johan Manzambi, Christian Fassnacht, Eray Coemert, Marvin Keller, Aurele Amenda, Luca Jaquez, Cedric Itten

Remove/not in official squad: Yann Sommer, Fabian Schar, Becir Omeragic, Leonidas Stergiou, Ulisses Garcia, Vincent Sierro, Kwadwo Duah, Andi Zeqiri

Normalised matches with different spelling/order: Yvon Mv Ogo ~= Yvon Mvogo

### Brazil

Matched: 17/26

Add from official squad: Weverton, Leo Pereira, Douglas Santos, Fabinho, Danilo Santos, Luiz Henrique, Roger Ibanez, Igor Thiago, Rayan

Remove/not in official squad: Bento, Carlos Augusto, Vitor Reis, Joao Gomes, Andreas Pereira, Ederson Silva, Gerson, Rodrygo, Joao Pedro

Normalised matches with different spelling/order: Neymar Jr ~= Neymar

### Morocco

Matched: 13/26

Add from official squad: Ayyoub Bouaddi, Chemsdine Talbi, Munir El Kajoui, Zakaria El Ouahdi, Issa Diop, Samir El Mourabet, Gessime Yassine, Youssef Belamm Ari, Ayoub Amaimouni, Ahmed Reda Tagnaouti, Neil El Aynaoui, Redouane Halhal, Anass Salah Eddine

Remove/not in official squad: Munir Mohamedi, El Mehdi Benabid, Romain Saiss, Abdelkabir Abqar, Yahia Attiyat Allah, Adam Aznou, Amir Richardson, Oussama Targhalline, Hakim Ziyech, Youssef En-Nesyri, Amine Adli, Zakaria Aboukhlal, Ilias Akhomach

Normalised matches with different spelling/order: Souane Rahimi ~= Soufiane Rahimi

### Haiti

Matched: 12/26

Add from official squad: Keeto Thermoncy, Hannes Delcroix, Carl Sainte, Bellegarde Jean-Ricner, Markhus Lacroix, Ruben Providence, Lenny Joseph, Wilson Isidor, Yassin Fortune, Josue Casimir, Jean-Kevin Duverne, Wilguens Paugain, Dominique Simon, Woodensky Pierre

Remove/not in official squad: Mechack Jerome, Alex Christian, Garven Metusala, Djimy Bend Alexis, Stephane Lambese, Bryan Alceus, Steeven Saba, Carnejy Antoine, Mondy Prunier, Shanyder Borgelin, Mikael Cantave, Christopher Attys, Belmar Joseph, Ronaldo Damus

Normalised matches with different spelling/order: Derrick Etienne ~= Derrick Etienne Jr, Louicius Deedson ~= Louicius Don Deedson

### Scotland

Matched: 17/26

Add from official squad: Tyler Fletcher, Liam Kelly, Ross Stewart, John Souttar, Dominic Hyam, Ben Gannon-Doak, George Hirst, Nathan Patterson, Findlay Curtis

Remove/not in official squad: Zander Clark, Ryan Porteous, Max Johnston, Billy Gilmour, Callum McGregor, Stuart Armstrong, Tommy Conway, Ben Doak, James Forrest

Normalised matches with different spelling/order: McLean Kenny ~= Kenny McLean

### USA

Matched: 16/26

Add from official squad: Auston Trusty, Giovanni Reyna, Sebastian Berhalter, Cristian Roldan, Alex Freeman, Max Arfsten, Timothy Weah, Matt Freese, Chris Brady, Alex Zendejas

Remove/not in official squad: Patrick Schulte, Ethan Horvath, Cameron Carter-Vickers, Kristoffer Lund, Yunus Musah, Gio Reyna, Johnny Cardoso, Luca de la Torre, Tim Weah, Josh Sargent

### Paraguay

Matched: 15/26

Add from official squad: Gustavo Velazquez, Mauricio, Orlando Gill, Jose Canale, Alejandro Romero Gamarra, Braian Ojeda, Gaston Olveira, Matias Galarza, Gustavo Caballero, Isidro Pitta, Alexandro Maidana

Remove/not in official squad: Roberto Fernandez, Carlos Coronel, Ivan Ramirez, Santiago Arzamendia, Matias Espinoza, Blas Riveros, Mathias Villasanti, Richard Sanchez, Oscar Romero, Angel Romero, Adam Bareiro

Normalised matches with different spelling/order: Juan Jose Caceres ~= Juan Caceres

### Australia

Matched: 12/26

Add from official squad: Milos Degenek, Jacob Italiano, Jason Geria, Mathew Leckie, Mohamed Toure, Awer Mabil, Cameron Devlin, Kai Trewin, Patrick Beach, Cristian Volpato, Nishan Velupillay, Paul Okon-Engstler, Lucas Herrington, Tete Yengi

Remove/not in official squad: Joe Gauci, Kye Rowles, Lewis Miller, Nathaniel Atkinson, Thomas Deng, Keanu Baccus, Riley McGree, Martin Boyle, Craig Goodwin, Garang Kuol, Mitchell Duke, Kusini Yengi, Adam Taggart, Brandon Borrello

### Turkey

Matched: 20/26

Add from official squad: Deniz Gul, Eren Elmali, Irfan Can Kahveci, Kaan Ayhan, Oguz Aydin, Can Uzun

Remove/not in official squad: Ridvan Yilmaz, Cengiz Under, Semih Kilicsoy, Bertug Yildirim, Cenk Tosun, Enes Unal

Normalised matches with different spelling/order: Alper Yilmaz Baris ~= Baris Alper Yilmaz

### Germany

Matched: 17/26

Add from official squad: Manuel Neuer, Jamie Leweling, Nick Woltemade, Pascal Gross, Angelo Stiller, Nathaniel Brown, Nadiem Amiri, Malick Thiaw, Lennart Karl

Remove/not in official squad: Marc-Andre ter Stegen, Maximilian Mittelstadt, Benjamin Henrichs, Robin Koch, Robert Andrich, Serge Gnabry, Niclas Fullkrug, Karim Adeyemi, Chris Fuhrich

Normalised matches with different spelling/order: Alexander Nuebel ~= Alexander Nubel, Antonio Ruediger ~= Antonio Rudiger

### Curaçao

Matched: 14/26

Add from official squad: Shurandy Sambo, Livano Comenencia, Juergen Locadia, Sontje Hansen, Tyrese Noslin, Arjany Martha, Armando Obispo, Joshua Brenet, Tahith Chong, Kevin Felida, Riechedly Bazoer, Deveron Fonville

Remove/not in official squad: Cuco Martina, Darryl Lachman, Vurnon Anita, Jafar Arias, Rangelo Janga, Charlison Benschop, Elson Hooi, Nigel Robertha, Rayvien Rosario, Richairo Zivkovic, Xander Severina, Gyrano Kerk

### Ivory Coast

Matched: 16/26

Add from official squad: Ange-Yoan Bonny, Yan Diomande, Elye Wahi, Christopher Operi, Mohamed Kone, Evann Guessand, Alban Lafont, Bazoumana Toure, Parfait Guiagon, Christ Inao Oulai

Remove/not in official squad: Badra Ali Sangare, Ira Tape, Serge Aurier, Willy Boly, Hamed Traore, Sebastien Haller, Christian Kouame, Karim Konate, Jonathan Bamba, Maxwel Cornet

### Ecuador

Matched: 18/26

Add from official squad: Jordy Alcivar, Anthony Valencia, Pedro Vite, Denil Castillo, Nilson Angulo, Gonzalo Valle, Jeremy Arevalo, Yaimar Medina

Remove/not in official squad: Alexander Dominguez, Xavier Arreaga, Jhoanner Chavez, Carlos Gruezo, Jeremy Sarmiento, Leonardo Campana, Michael Estrada, Angel Mena

Normalised matches with different spelling/order: Willian Pacho ~= William Pacho

### Netherlands

Matched: 16/26

Add from official squad: Marten De Roon, Jan Paul Van Hecke, Justin Kluivert, Mats Wieffer, Robin Roefs, Guus Til, Teun Koopmeiners, Crysencio Summerville, Jorrel Hato, Quinten Timber

Remove/not in official squad: Justin Bijlow, Matthijs de Ligt, Stefan de Vrij, Jeremie Frimpong, Quilindschy Hartman, Xavi Simons, Joey Veerman, Jerdy Schouten, Joshua Zirkzee, Steven Bergwijn

### Japan

Matched: 16/26

Add from official squad: Yuto Nagatomo, Keisuke Goto, Tsuyoshi Watanabe, Yuito Suzuki, Koki Ogawa, Ayumu Seko, Tomoki Hayakawa, Kaishu Sano, Junnosuke Suzuki, Kento Shiogai

Remove/not in official squad: Daiya Maekawa, Yuta Nakayama, Seiya Maikuma, Koki Machida, Daiki Hashioka, Hidemasa Morita, Takumi Minamino, Reo Hatate, Kaoru Mitoma, Kyogo Furuhashi

Normalised matches with different spelling/order: Kou Itakura ~= Ko Itakura

### Sweden

Matched: 25/26

Add from official squad: Herman Johansson

Remove/not in official squad: Emil Holm

Normalised matches with different spelling/order: Eric Smith ~= Erik Smith

### Tunisia

Matched: 8/26

Add from official squad: Mouhib Chamakh, Omar Rekik, Adam Arous, Elias Saad, Hazem Mastouri, Ismael Gharbi, Mortadha Ben Ouanes, Rani Khedira, Khalil Ayari, Mohamed Hadj Mahmoud, Rayan Elloumi, Firas Chaouat, Yan Valery, Mohamed Amine Ben Hmida, Sabri Ben Hessen, Moutaz Neffati, Raed Chikhaoui, Sebastian Tounekti

Remove/not in official squad: Bechir Ben Said, Mouez Hassen, Wajdi Kechrida, Nader Ghandri, Yassine Meriah, Alaa Ghram, Mohamed Drager, Oussama Haddadi, Aissa Laidouni, Hamza Rafia, Ferjani Sassi, Mohamed Ali Ben Romdhane, Youssef Msakni, Seifeddine Jaziri, Issam Jebali, Naim Sliti, Haythem Jouini, Sayfallah Ltaief

Normalised matches with different spelling/order: Anis Slimane ~= Anis Ben Slimane

### Belgium

Matched: 16/26

Add from official squad: Brandon Mechele, Senne Lammens, Mike Penders, Joaquin Seys, Diego Moreira, Hans Vanaken, Alexis Saelemaekers, Nicolas Raskin, Nathan Ngoy, Matias Fernandez-Pardo

Remove/not in official squad: Koen Casteels, Matz Sels, Wout Faes, Ameen Al-Dakhil, Orel Mangala, Arthur Vermeeren, Romeo Lavia, Lois Openda, Johan Bakayoko, Michy Batshuayi

### Egypt

Matched: 10/26

Add from official squad: Yasser Ibrahim, Mohamed Hany, Hossam Abdelmaguid, Ramy Rabia, Hamza Abdelkarim, Mostafa Zico, Haissem Hassan, Hamdy Fathy, Karim Hafez, Soliman Mahdy, Mohanad Lashin, Nabil Donga, Attia Marawan, Saber Mahmoud, Tarek Alaa, Mohamed Alaa

Remove/not in official squad: Mohamed Awad, Ahmed Hegazy, Omar Kamal, Ahmed Ramadan, Mohamed Hamdi, Akram Tawfik, Hamdi Fathi, Mohamed Elneny, Marwan Attia, Mostafa Fathi, Mostafa Mohamed, Ahmed Hassan Kouka, Mahmoud Kahraba, Ramadan Sobhi, Hussein El Shahat, Karim Fouad

Normalised matches with different spelling/order: Mohamed Elshenawy ~= Mohamed El Shenawy, Mohamed Abdelmoneim ~= Mohamed Abdelmonem, Mostafa Shoubir ~= Mostafa Shobeir

### Iran

Matched: 14/26

Add from official squad: Ali Alipour, Hossein Kanani, Roozbeh Cheshmi, Mehdi Torabi, Arya Yousefi, Amirhossein Hosseinzadeh, Shahriyar Moghanloo, Mohammad Ghorbani, Ramin Rezaeian, Dennis Dargahi, Danial Iri, Amirmohammad Razaghinia

Remove/not in official squad: Hossein Kanaanizadegan, Majid Hosseini, Sadegh Moharrami, Omid Noorafkan, Ahmad Noorollahi, Omid Ebrahimi, Ali Gholizadeh, Sardar Azmoun, Karim Ansarifard, Shahriar Moghanlou, Allahyar Sayyadmanesh, Reza Asadi

Normalised matches with different spelling/order: Mohammad Mohebbi ~= Mohammad Mohebi, Ehsan Hajisafi ~= Ehsan Hajsafi

### New Zealand

Matched: 21/26

Add from official squad: Alex Rufer, Jesse Randall, Ryan Thomas, Callan Elliot, Lachlan Bayliss

Remove/not in official squad: Bill Tuiloma, Clayton Lewis, Alex Greive, Marco Rojas, Max Mata

Normalised matches with different spelling/order: Matthew Garbett ~= Matt Garbett

### Spain

Matched: 18/26

Add from official squad: Marc Pubill, Alex Grimaldo, Eric Garcia, Marcos Llorente, Yeremy Pino, Joan Garcia, Victor Munoz, Borja Iglesias

Remove/not in official squad: Alex Remiro, Dani Carvajal, Robin Le Normand, Alejandro Grimaldo, Dani Vivian, Inigo Martinez, Alvaro Morata, Ayoze Perez

### Cape Verde

Matched: 12/26

Add from official squad: Diney Borges, Pico Lopes, Kevin Pina, Gilson Benchimol, Sidny Lopes Cabral, Laros Duarte, Yannick Semedo, Telmo Arcanjo, Nuno da Costa, Steven Moreira, Cj dos Santos, Wagner Pina, Kelvin Pires, Helio Varela

Remove/not in official squad: Bruno Varela, Roberto Lopes, Steven Fortes, Dylan Tavares, Diney, Pico, Kenny Rocha Santos, Patrick Andrade, Nuno Borges, Lisandro Semedo, Gilson Tavares, Julio Tavares, Bebe, Benchimol

Normalised matches with different spelling/order: Joao Paulo ~= Joao Paulo Fernandes

### Saudi Arabia

Matched: 15/26

Add from official squad: Ali Majrashi, Ali Lajami, Feras Albrikan, Nawaf Bu Washl, Abdullah Alkhaibari, Ziyad Aljohani, Khalid Alghannam, Ala Alhajji, Sultan Mandash, Jehad Thikri, Mohammed Abu Alshamat

Remove/not in official squad: Ali Al-Bulayhi, Yasser Al-Shahrani, Sultan Al-Ghannam, Mohammed Al-Breik, Abdullah Otayf, Abdulelah Al-Malki, Sami Al-Najei, Abdulrahman Ghareeb, Firas Al-Buraikan, Hattan Bahebri, Ali Al-Hassan

Normalised matches with different spelling/order: Abdullah Alhamddan ~= Abdullah Al-Hamdan, Mohamed Kanno ~= Mohammed Kanno, Hassan Altambakti ~= Hassan Tambakti, Hassan Kadish ~= Hassan Kadesh, Aiman Yahya ~= Ayman Yahya

### Uruguay

Matched: 19/26

Add from official squad: Rodrigo Aguirre, Maxi Araujo, Federico Vinas, Fernando Muslera, Santiago Bueno, Juan Manuel Sanabria, Rodrigo Zalazar

Remove/not in official squad: Randall Rodriguez, Nahitan Nandez, Nicolas Marichal, Maximiliano Araujo, Luciano Rodriguez, Cristian Olivera, Miguel Merentiel

### France

Matched: 17/26

Add from official squad: Malo Gusto, Lucas Digne, Manu Kone, Desire Doue, Jean-Philippe Mateta, Robin Risser, Rayan Cherki, Maghnes Akliouche, Maxence Lacroix

Remove/not in official squad: Alphonse Areola, Benjamin Pavard, Jonathan Clauss, Ferland Mendy, Eduardo Camavinga, Youssouf Fofana, Antoine Griezmann, Randal Kolo Muani, Kingsley Coman

### Senegal

Matched: 17/26

Add from official squad: Yehvann Diouf, Mamadou Sarr, Pathe Ciss, Assane Diao, Bamba Dieng, Ibrahim Mbaye, Bara Sapoko Ndiaye, Antoine Mendy, Diouf El Hadji Malick

Remove/not in official squad: Seny Dieng, Abdou Diallo, Formose Mendy, Youssouf Sabaly, Mikayil Faye, Nampalys Mendy, Boulaye Dia, Habib Diallo, Abdallah Sima

Normalised matches with different spelling/order: Idrissa Gana Gueye ~= Idrissa Gueye

### Iraq

Matched: 15/26

Add from official squad: Rebin Ghareeb, Akam Hashim, Munaf Younus, Ahmed Qasim, Ali Yousif, Ahmed Yahya, Ali Jasim, Kevin Yakob, Aimar Sher, Zaid Ismael, Mustafa Saadoon

Remove/not in official squad: Ali Adnan, Rebin Sulaka, Mustafa Nadhim, Saad Natiq, Ahmed Ibrahim, Amjad Attwan, Bashar Resan, Osama Rashid, Ahmed Yasin, Muntadher Mohammed, Danilo Al-Saed

Normalised matches with different spelling/order: Amir Alamm Ari ~= Amir Al-Ammari, Frans Putros ~= Frans Dhia Putros

### Norway

Matched: 19/26

Add from official squad: Sander Tangvik, Torbjorn Heggem, Thelo Aasgaard, Andreas Schjelderup, Jens Petter Hauge, Sondre Langas, Henrik Falchener

Remove/not in official squad: Mathias Dyngeland, Stefan Strandberg, Andreas Hanche-Olsen, Stian Gregersen, Mohamed Elyounoussi, Ola Solbakken, Aron Donnum

Normalised matches with different spelling/order: Marcus Holmgren Pedersen ~= Marcus Pedersen, Fredrik Andre Bjorkan ~= Fredrik Bjorkan

### Argentina

Matched: 22/26

Add from official squad: Valentin Barco, Giuliano Simeone, Nico Paz, Jose Manuel Lopez

Remove/not in official squad: Marcos Acuna, Alejandro Garnacho, Paulo Dybala, Franco Mastantuono

Normalised matches with different spelling/order: Nico Gonzalez ~= Nicolas Gonzalez

### Algeria

Matched: 13/26

Add from official squad: Melvin Mastil, Achraf Abada, Anis Hadj Moussa, Nadhir Benbouali, Hicham Boudaoui, Oussama Benbot, Rak Belghali, Adil Boulbina, Ibrahim Maza, Luca Zidane, Yassine Titraoui, Fares Ghedjemis, Samir Chergui

Remove/not in official squad: Anthony Mandrea, Alexandre Oukidja, Mustapha Zeghba, Youcef Atal, Kevin Guitoun, Ahmed Touba, Ismael Bennacer, Adem Zorgane, Yacine Brahimi, Baghdad Bounedjah, Said Benrahma, Islam Slimani, Andy Delort

Normalised matches with different spelling/order: Zineddine Belaid ~= Zinedine Belaid

### Austria

Matched: 18/26

Add from official squad: David Affengruber, Xaver Schlager, Florian Wiegele, Carney Chukwuemeka, Marco Friedl, Paul Wanner, Michael Svoboda, Alessandro Schoepf

Remove/not in official squad: Niklas Hedl, Maximilian Wober, Gernot Trauner, Flavius Daniliuc, Leopold Querfeld, Maximilian Entrup, Junior Adamu, Andreas Weimann

Normalised matches with different spelling/order: Phillip Mwene ~= Phillipp Mwene

### Jordan

Matched: 14/26

Add from official squad: Husam Abudahab, Amer Jamous, Odeh Fakhoury, Nour Baniateyah, Mohammad Abualnadi, Saleem Obaid, Ibrahim Sabra, Mohannad Abutaha, Abdallah Alfakhori, Ali Azaizeh, Mohammad Aldaoud, Anas Badawi

Remove/not in official squad: Abdullah Al-Fakhouri, Ahmad Al-Jaidi, Salem Al-Ajalin, Bara' Marei, Feras Shelbaieh, Anas Bani Yaseen, Saleh Rateb, Yazan Al-Naimat, Hamza Al-Dardour, Baha Faisal, Anas Al-Awadat, Yousef Al-Rawashdeh

Normalised matches with different spelling/order: Mohammad Abuhasheesh ~= Mohammad Abu Hasheesh, Mousa Altamari ~= Mousa Al-Taamari, Saed Alrosan ~= Saeed Al-Rosan, Mohammad Abuzraiq ~= Mohammad Abu Zrayq, Mahmoud Almardi ~= Mahmoud Mardi, Ehsan Haddad ~= Ihsan Haddad

### Portugal

Matched: 20/26

Add from official squad: Tomas Araujo, Renato Veiga, Francisco Trincao, Goncalo Guedes, Rui Silva, Samu Costa

Remove/not in official squad: Rui Patricio, Antonio Silva, Toti Gomes, Joao Palhinha, Otavio, Diogo Jota

### DR Congo

Matched: 19/26

Add from official squad: Aaron Wan-Bissaka, Steve Kapuadi, Ngalayel Mukau, Nathanael Mbuku, Brian Cipenga, Noah Sadiki, Matthieu Epolo

Remove/not in official squad: Dimitry Bertaud, Henock Inonga, Rocky Bushiri, Vital Nsimba, Silas Katompa Mvumpa, Jackson Muleka, Dodi Lukebakio

Normalised matches with different spelling/order: Lionel Mp Asi ~= Lionel Mpasi, Tshibola Aaron ~= Aaron Tshibola

### Uzbekistan

Matched: 19/26

Add from official squad: Akmal Mozgovoy, Botirali Ergashev, Abdulla Abdullaev, Sherzod Esanov, Behruzjon Karimov, Avazbek Ulmasaliyev, Jakhongir Urozov

Remove/not in official squad: Vladimir Nazarov, Ibrohimkhalil Yuldoshev, Mukhammadkodir Hamraliev, Diyor Ortikboev, Jasurbek Jaloliddinov, Ruslanbek Jiyanov, Khusain Norchaev

Normalised matches with different spelling/order: Abduvohid Nematov ~= Abduvokhid Nematov, Odiljon Xamrobekov ~= Odiljon Khamrobekov, Rustam Ashurmatov ~= Rustamjon Ashurmatov, Umar Eshmurodov ~= Umarbek Eshmurodov

### Colombia

Matched: 17/26

Add from official squad: Jhon Cordoba, Gustavo Puerta, Juan Portilla, Willer Ditta, Cucho Hernandez, Jaminton Campaz, Alvaro Montero, Luis Suarez, Andres Gomez

Remove/not in official squad: Kevin Mier, Carlos Cuesta, Yerson Mosquera, Mateus Uribe, Jhon Duran, Rafael Santos Borre, Luis Sinisterra, Miguel Borja, Yaser Asprilla

Normalised matches with different spelling/order: Juan Quintero ~= Juan Fernando Quintero

### England

Matched: 15/26

Add from official squad: Nico Oreilly, Elliot Anderson, Tino Livramento, Jordan Henderson, Dan Burn, Morgan Rogers, Noni Madueke, Ivan Toney, James Trafford, Djed Spence, Jarell Quansah

Remove/not in official squad: Aaron Ramsdale, Kyle Walker, Levi Colwill, Trent Alexander-Arnold, Luke Shaw, Ben Chilwell, Phil Foden, Cole Palmer, Conor Gallagher, Morgan Gibbs-White, Jarrod Bowen

### Croatia

Matched: 17/26

Add from official squad: Nikola Moro, Ivor Pandur, Petar Sucic, Kristijan Jakic, Toni Fruk, Luka Vuskovic, Dominik Kotarski, Marco Pasalic, Petar Musa

Remove/not in official squad: Ivica Ivusic, Nediljko Labrovic, Borna Sosa, Josip Juranovic, Domagoj Vida, Marcelo Brozovic, Lovro Majer, Bruno Petkovic, Mislav Orsic

### Ghana

Matched: 11/26

Add from official squad: Caleb Yirenkyi, Jonas Adjetey, Abdul Mumin, Kwasi Sibo, Brandon Thomas-Asante, Joseph Anang, Christopher Bonsu Baah, Benjamin Asare, Baba Rahman, Jerome Opoku, Augustine Boakye, Kojo Peprah Oppong, Derrick Luckassen, Prince Adu, Marvin Senaya

Remove/not in official squad: Jojo Wollacott, Richard Ofori, Mohammed Salisu, Alexander Djiku, Daniel Amartey, Tariq Lamptey, Denis Odoi, Kingsley Schindler, Patrick Kpozo, Majeed Ashimeru, Salis Abdul Samed, Daniel-Kofi Kyereh, Mohammed Kudus, Osman Bukari, Joseph Paintsil

Normalised matches with different spelling/order: Lawrence Ati Zigi ~= Lawrence Ati-Zigi, Fatawu Issahaku ~= Abdul Fatawu Issahaku

### Panama

Matched: 21/26

Add from official squad: Edgardo Farina, Tomas Rodriguez, Carlos Harvey, Azarias Londono, Jorge Gutierrez

Remove/not in official squad: Eduardo Anderson, Abdiel Ayarza, Jovani Welch, Freddy Gondola, Rolando Blackburn

Normalised matches with different spelling/order: Amir Murillo ~= Michael Amir Murillo, Edgar Yoel Barcenas ~= Edgar Barcenas
