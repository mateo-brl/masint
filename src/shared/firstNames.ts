// Prénoms courants, en minuscules sans accents : France, pays francophones, pays anglophones,
// Europe du Sud et du Nord, Maghreb, Afrique de l'Ouest, Turquie, Europe de l'Est. Liste
// courte et embarquée : elle sert à reconnaître « Prénom Nom » dans un nom d'appelant, pas à
// trancher l'état civil.

const LIST = `
aaron abdel abdallah abdelkader abdou abdoulaye abdul adam adele adeline adrian adriana adrien agathe agnes ahmed aicha
aida alain alan alba albert alberto alessandro alessia alex alexander alexandra alexandre alexia alexis alfred ali alia
alice alicia aline alison amadou amandine amaury amel amelia amelie amine amir amira amy ana anais andre andrea andreas
andrei andres andrew angel angela angele angelique anissa anna annabelle anne annie anthony antoine antoinette antonio
apolline arnaud arthur assia astrid audrey augustin aurelie aurelien aurore axel aya aymeric baptiste barbara bastien
beatrice ben benjamin benoit bernadette bernard bertrand blanche boris brahim brandon brigitte bruno camille capucine
carla carlos carmen caroline catherine cecile cedric celia celine chantal charles charlie charline charlotte chiara
chloe christelle christian christiane christine christophe claire clara claude claudia claudine clemence clement
colette coralie corinne cyril cyrille damien dan daniel daniela daniele danielle dany david deborah delphine denis
denise diane didier dimitri djamel dominique dorian dorothee driss dylan eddy edgar edith edouard eleonore elias elie
eliot elisa elisabeth elise elodie eloise elsa emeline emilie emilien emily emma emmanuel emmanuelle enzo eric erica
erik ernest esteban estelle esther etienne eugene eva eve evelyne fabien fabienne fabrice fanny farid fatima fatoumata
felix fernand fernando florence florent florian franck francis francine francisco francois francoise frank frederic
frederique gabriel gabrielle gael gaelle gaetan garance gaspard gauthier genevieve geoffrey georges gerald gerard
germain ghislaine gilbert gilles ginette giovanni gisele giulia gregoire gregory guillaume gustave guy hakim halima
hamid hannah harry hassan hector helene henri herve hugo hugues ibrahim ines irene isaac isabelle ismael ivan jack
jacky jacqueline jacques jade james jamel jean jeanne jeannine jennifer jeremie jeremy jerome jessica jessy joachim
joel joelle johan johanna john jonathan jordan jose josee joseph josephine josiane joshua juan jules julia julian
juliana julie julien juliette justin justine kader kamel karim karima karine kelly kenza kevin khadija lamia lara
laura laure laurence laurent lea leila lena leo leon leonard leonie lilian liliane lina linda lisa lise loic lola
lorenzo louis louise luc luca lucas lucia lucie lucien lucile ludovic luis luna lydia lydie madeleine maelle magali
mahmoud malik malika manon manuel manuela marc marcel marco margaux margot maria marianne marie marine mario marion
marius marjorie marlene martin martine marwa mathias mathieu mathilde matteo matthew matthias matthieu maud maurice
max maxence maxime medhi mehdi melanie melissa michael michel michele micheline mickael milan mireille mohamed
mohammed monique morgan morgane moussa mustapha myriam nabil nadia nadine nadir nancy naomi natacha natalia nathalie
nathan nicolas nicole nina noah noe noel noemie nora oceane octave odette odile olga olivia olivier omar oscar pablo
paola pascal pascale patrice patricia patrick paul paula paule paulette pauline pedro perrine philippe pierre
pierrette quentin rachel rachid rafael rania raoul raphael raphaelle raymond rebecca regine remi remy renaud rene
renee richard robert roberto robin rodolphe rodrigue roger roland romain romane rose roxane ruben ryan sabine sabrina
sacha safia said salim salma salome samia samir samira samuel sandra sandrine sara sarah sebastien serge sergio
severine sidonie silvia simon simone slimane sofia sofiane solene sonia sophie stephane stephanie steve steven suzanne
sylvain sylvie tania tatiana theo theodore therese thibault thibaut thierry thomas tiphaine tom tony tristan ulysse
valentin valentine valerie vanessa victor victoria vincent violette virginie vivien vivienne william xavier yacine
yann yannick yasmine yassine yohan youssef yves yvette yvonne zacharie zakaria zineb zoe
abigail adriano agnieszka aleksandra alessandra amanda andrzej angelo anil anita ashley barry beatriz bianca bogdan
brian bruce bryan carl carol carolina cesar chen chris christina christopher cindy craig cristina dana darius dawn
dennis diana diego dmitri donald donna dorota douglas duncan dustin edward elena elif emre eduardo ewa fatih fiona
francesca gary george gina giuseppe grace greg hans heather heidi helen henry hiroshi hugh ian igor ingrid irina jakub
jan janet jason javier jeff jeffrey jenny jerry jessie jill jim joan joanna joao jorge joyce juergen jurgen karen
karl katarzyna kate katherine kathleen kathy keith ken kenneth kim krzysztof kurt larry lars laszlo lee leonardo
liam lin linda lisa liu lorraine lucy luigi lynn magdalena marek margaret marta matt megan mehmet melissa mia
michelle miguel mike mustafa nadia natasha neil nikolai nikola olena oleg oliver pamela patrizia pavel peter petra
piotr rachel ralph raul rebecca ricardo rita robert rosa ruth ryan salvatore samantha sandro scott sean sergei
sharon shirley simona stefan stefano steven susan svetlana sven tamara teresa terry tim timothy tobias todd tomas
ulrich valentina vera victor vladimir walter wang wayne wei wolfgang yuki yusuf zeynep
aboubacar adama aissatou alassane alpha amadou aminata awa ayoub bakary boubacar cheikh coumba daouda demba djibril
fode habib hawa ibrahima idrissa issa kadiatou kadidia lamine mamadou mariama modou oumar ousmane rokia seydou
souleymane yaya
`

/** Prénoms courants, en minuscules sans accents. */
export const FIRST_NAMES: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter(Boolean))

/** Forme comparée d'un prénom : minuscules, sans accents, sans apostrophes. */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .trim()
}

/** Prénom courant, y compris composé (« Jean-Pierre », « Marie-Claire »). */
export function isFirstName(token: string): boolean {
  const t = foldName(token)
  if (!t) return false
  if (FIRST_NAMES.has(t)) return true
  const parts = t.split('-').filter(Boolean)
  return parts.length > 1 && parts.every((p) => FIRST_NAMES.has(p))
}
