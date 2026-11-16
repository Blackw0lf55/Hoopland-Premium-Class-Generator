function parseWnbaDraftBoard(
  html
) {

  const players = [];

  const linkPattern =
    /<a[^>]+href=["'][^"']*\/draft\/2026\/prospects\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;


  function cleanText(
    fragment
  ) {

    return fragment
      .replace(
        /<[^>]*>/g,
        " "
      )
      .replace(
        /&nbsp;/g,
        " "
      )
      .replace(
        /&amp;/g,
        "&"
      )
      .replace(
        /&#x27;|&#39;/g,
        "'"
      )
      .replace(
        /&quot;/g,
        "\""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  }


  function statValue(
    value
  ) {

    if (
      !value ||
      value === "--"
    ) {

      return null;

    }


    const number =
      Number(
        value
      );


    return Number.isFinite(
      number
    )
      ? number
      : null;

  }


  let linkMatch;


  while (
    (
      linkMatch =
        linkPattern.exec(
          html
        )
    ) !== null
  ) {

    const text =
      cleanText(
        linkMatch[1]
      );


    const playerMatch =
      text.match(
        /^(.+?)\s+(Guard|Forward|Center)\s+(.+?)\s+PPG\s+(--|\d+(?:\.\d+)?)\s+RPG\s+(--|\d+(?:\.\d+)?)\s+APG\s+(--|\d+(?:\.\d+)?)\s+FG%\s+(--|\d+(?:\.\d+)?)$/i
      );


    if (
      !playerMatch
    ) {

      continue;

    }


    const name =
      playerMatch[1].trim();

    const position =
      playerMatch[2].trim();

    const schoolCountry =
      playerMatch[3].trim();


    const parts =
      schoolCountry
        .split(" / ")
        .map(
          item =>
            item.trim()
        );


    const team =
      parts[0] ||
      "";


    const country =
      parts.length > 1
        ? parts[
            parts.length - 1
          ]
        : null;


    const nameParts =
      name.split(
        /\s+/
      );


    const firstName =
      nameParts.shift() ||
      "";


    const lastName =
      nameParts.join(
        " "
      );


    players.push({

      fn:
        firstName,

      ln:
        lastName,

      position:
        position,

      team:
        team,

      country:
        country,

      stats: {

        ppg:
          statValue(
            playerMatch[4]
          ),

        rpg:
          statValue(
            playerMatch[5]
          ),

        apg:
          statValue(
            playerMatch[6]
          ),

        fgPct:
          statValue(
            playerMatch[7]
          )

      }

    });

  }


  return players;

}

function normalizePlayerName(
  value
) {

  return String(
    value || ""
  )
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[’']/g,
      ""
    )
    .replace(
      /[^a-zA-Z0-9]/g,
      ""
    )
    .toLowerCase();

}


function cleanBiographyText(
  html
) {

  return String(
    html || ""
  )
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]*>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
  /&#x27;|&#39;|&apos;/gi,
  "'"
)
    .replace(
      /&quot;/gi,
      "\""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}

function parseUsbasketBiographies(
  html,
  draftPlayers
) {

  const decodedHtml =
    String(
      html || ""
    )
      .replace(
        /\\u003C/gi,
        "<"
      )
      .replace(
        /\\u003E/gi,
        ">"
      )
      .replace(
        /\\u0026/gi,
        "&"
      )
      .replace(
        /\\"/g,
        "\""
      )
      .replace(
        /\\r|\\n|\\t/g,
        " "
      );


  const text =
    cleanBiographyText(
      decodedHtml
    );


  const biographies = [];


  draftPlayers.forEach(
    player => {

      const fullName =
        [
          player.fn,
          player.ln
        ]
          .filter(Boolean)
          .join(" ");


      let searchIndex =
        0;

      let biography =
        null;


      while (
        searchIndex <
        text.length
      ) {

        const nameIndex =
          text.indexOf(
            fullName,
            searchIndex
          );


        if (
          nameIndex < 0
        ) {

          break;

        }


        const nearbyText =
          text.slice(
            nameIndex,
            nameIndex + 350
          );


        const physicalMatch =
          nearbyText.match(
            /$$\s*(\d+)\s*['’]\s*(\d+)\s*(?:['’]{2}|")\s*-\s*([A-Z]+(?:\/[A-Z]+)*)(?:\s*-\s*(\d{4}))?\s*$$/
          );


        if (
          physicalMatch
        ) {

          const feet =
            Number(
              physicalMatch[1]
            );

          const inches =
            Number(
              physicalMatch[2]
            );


          biography = {

            fullName:
              fullName,

            nameKey:
              normalizePlayerName(
                fullName
              ),

            height:
              feet * 12 +
              inches,

            sourcePosition:
              physicalMatch[3],

            birthYear:
              physicalMatch[4]
                ? Number(
                    physicalMatch[4]
                  )
                : null,

            source:
              "USbasket 2026 WNBA Draft"

          };


          break;

        }


        searchIndex =
          nameIndex +
          fullName.length;

      }


      if (
        biography
      ) {

        biographies.push(
          biography
        );

      }

    }
  );


  return biographies;

}

      
function mergeDraftBiographies(
  players,
  biographies
) {

  const biographyMap =
    new Map();


  biographies.forEach(
    biography => {

      biographyMap.set(
        biography.nameKey,
        biography
      );

    }
  );


  return players.map(
    player => {

      const fullName =
        [
          player.fn,
          player.ln
        ]
          .filter(Boolean)
          .join(" ");


      const nameKey =
        normalizePlayerName(
          fullName
        );


      const biography =
        biographyMap.get(
          nameKey
        );


      if (!biography) {

        return {

          ...player,

          biographyMatched:
            false,

          height:
            null,

          birthYear:
            null,

          draftPick:
            null,

          sourcePosition:
            player.position,

          bioPosition:
            null

        };

      }


      return {

        ...player,

        biographyMatched:
          true,

        height:
          biography.height,

        birthYear:
          biography.birthYear,

        draftPick:
          biography.draftPick,

        sourcePosition:
          player.position,

        bioPosition:
          biography.sourcePosition

      };

    }
  );

}

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(
        request.url
      );


 if (
  url.pathname ===
  "/api/class-data"
) {

  const gender =
    url.searchParams.get(
      "gender"
    );

  const type =
    url.searchParams.get(
      "type"
    );

  const year =
    url.searchParams.get(
      "year"
    );


  /*
    First live source connection:
    Official WNBA Draft Board.
  */

  if (
    gender === "women" &&
    type === "draft" &&
    year === "2026"
  ) {

    const sourceURL =
      "https://www.wnba.com/draft/2026/board";
const biographyURL =
  "https://www.usbasket.com/WNBA/news/986346/WNBA-Draft-2026";


    const sourceResponse =
      await fetch(
        sourceURL,
        {
          headers: {
            "User-Agent":
              "Hoopland-Class-Generator/1.0"
          }
        }
      );
const biographyResponse =
  await fetch(
    biographyURL,
    {
      headers: {
        "User-Agent":
          "Hoopland-Class-Generator/1.0"
      }
    }
  );


    if (
      !sourceResponse.ok
    ) {

      return Response.json(
        {
          ok:
            false,

          error:
            "WNBA source request failed.",

          sourceStatus:
            sourceResponse.status
        },
        {
          status:
            502
        }
      );

    }


    const sourceText =
      await sourceResponse.text();

    const biographyText =
  biographyResponse.ok
    ? await biographyResponse.text()
    : "";

    const physicalIndex =
  biographyText.indexOf(
    "5'11"
  );

const biographySample =
  physicalIndex >= 0
    ? biographyText.slice(
        Math.max(
          0,
          physicalIndex - 300
        ),
        physicalIndex + 500
      )
    : "Physical marker not found";
    
const biographies =
  biographyText
    ? parseUsbasketBiographies(
        biographyText,
        draftPlayers
      )
    : [];


    const draftPlayers =
  parseWnbaDraftBoard(
    sourceText
  );


const players =
  mergeDraftBiographies(
    draftPlayers,
    biographies
  );


    return Response.json({

      ok:
        true,

      message:
        "Official WNBA draft source connected.",

      request: {
        gender:
          gender,

        type:
          type,

        year:
          year
      },

      source: {
        name:
          "WNBA 2026 Draft Board",

        connected:
          true,

        status:
          sourceResponse.status,

        charactersReceived:
          sourceText.length,

        containsKnownDraftPick:
          sourceText.includes(
            "Azzi Fudd"
          ),
       
        biographiesParsed:
  biographies.length,

biographyStatus:
  biographyResponse.status,

biographyCharacters:
  biographyText.length,

biographyContainsAzzi:
  biographyText.includes(
    "Azzi Fudd"
  ),

biographySample:
  biographySample

      },

      players:
       players


    });

  }


  return Response.json(
    {
      ok:
        false,

      error:
        "No real-player source configured for this class yet.",

      request: {
        gender:
          gender,

        type:
          type,

        year:
          year
      }
    },
    {
      status:
        400
    }
  );

}

    return env.ASSETS.fetch(
      request
    );

  }

};
