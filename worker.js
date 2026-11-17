function parseWnbaDraftBoard(
  html
) {

  const players = [];

  let linksFound = 0;
let rejectedPlayers = 0;
const rejectedSamples = [];

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

    linksFound++;

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

  rejectedPlayers++;

  if (
    rejectedSamples.length < 10
  ) {

    rejectedSamples.push(
      text
    );
  }

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


    players.diagnostics = {

    linksFound:
      linksFound,

    acceptedPlayers:
      players.length,

    rejectedPlayers:
      rejectedPlayers,

    rejectedSamples:
      rejectedSamples

  };


  return players;

}

function parseWnbaProspectIndex(
  html
) {

  function cleanText(
    fragment
  ) {

    return String(
      fragment || ""
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
        /&middot;|&#183;/gi,
        " · "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  }


  function splitName(
    fullName
  ) {

    const nameParts =
      String(
        fullName || ""
      )
        .trim()
        .split(
          /\s+/
        );


    const firstName =
      nameParts.shift() ||
      "";


    return {

      fn:
        firstName,

      ln:
        nameParts.join(
          " "
        )

    };

  }


  function splitTeamCountry(
    value
  ) {

    const parts =
      String(
        value || ""
      )
        .split(
          " / "
        )
        .map(
          item =>
            item.trim()
        )
        .filter(Boolean);


    if (
      parts.length > 1
    ) {

      return {

        team:
          parts
            .slice(
              0,
              -1
            )
            .join(
              " / "
            ),

        country:
          parts[
            parts.length - 1
          ]

      };

    }


    const countryOnlyNames =
      new Set([
        "Australia",
        "China",
        "France",
        "Germany",
        "Hungary",
        "Japan",
        "New Zealand",
        "Spain"
      ]);


    if (
      countryOnlyNames.has(
        parts[0]
      )
    ) {

      return {

        team:
          "",

        country:
          parts[0]

      };

    }


    return {

      team:
        parts[0] ||
        "",

      country:
        null

    };

  }


  function parseDraftResult(
    value
  ) {

    const resultText =
      String(
        value || ""
      )
        .replace(
          /—/g,
          ""
        )
        .trim();


    const overallMatch =
      resultText.match(
        /(\d+)(?:st|nd|rd|th)\s+Overall/i
      );


    const roundPickMatch =
      resultText.match(
        /Round\s+(\d+)\s*[·\-]\s*Pick\s+(\d+)/i
      );


    return {

      drafted:
        Boolean(
          overallMatch ||
          roundPickMatch
        ),

      draftRound:
        roundPickMatch
          ? Number(
              roundPickMatch[1]
            )
          : null,

      roundPick:
        roundPickMatch
          ? Number(
              roundPickMatch[2]
            )
          : null,

      draftPick:
        overallMatch
          ? Number(
              overallMatch[1]
            )
          : null,

      draftResult:
        resultText ||
        null

    };

  }


  const prospects = [];

  const rowPattern =
    /<tr[^>]*>([\s\S]*?)<\/tr>/gi;


  let rowMatch;


  while (
    (
      rowMatch =
        rowPattern.exec(
          html
        )
    ) !== null
  ) {

    const cells = [];

    const cellPattern =
      /<td[^>]*>([\s\S]*?)<\/td>/gi;


    let cellMatch;


    while (
      (
        cellMatch =
          cellPattern.exec(
            rowMatch[1]
          )
      ) !== null
    ) {

      cells.push(
        cleanText(
          cellMatch[1]
        )
      );
    }


    if (
      cells.length < 3
    ) {

      continue;
    }


    const fullName =
      cells[0];


    const sourcePosition =
      cells[1] ||
      null;


    const teamCountry =
      splitTeamCountry(
        cells[2]
      );


    const draftResult =
      parseDraftResult(
        cells[3] ||
        ""
      );


    if (
      !fullName ||
      fullName.toUpperCase() ===
        "NAME"
    ) {

      continue;
    }


    const name =
      splitName(
        fullName
      );


    if (
      !name.fn ||
      !name.ln
    ) {

      continue;
    }


    prospects.push({

      fn:
        name.fn,

      ln:
        name.ln,

      position:
        sourcePosition,

      team:
        teamCountry.team,

      country:
        teamCountry.country,

      stats: {

        ppg:
          null,

        rpg:
          null,

        apg:
          null,

        fgPct:
          null

      },

      drafted:
        draftResult.drafted,

      draftRound:
        draftResult.draftRound,

      roundPick:
        draftResult.roundPick,

      draftPick:
        draftResult.draftPick,

      draftResult:
        draftResult.draftResult,

      poolSource:
        "WNBA 2026 Prospect Index"

    });

  }


  prospects.diagnostics = {

    rowsParsed:
      prospects.length

  };


  return prospects;

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

function mergeProspectPoolWithDraftBoard(
  prospects,
  draftBoardPlayers
) {

  const fullNameKey =
    player =>
      normalizePlayerName(
        [
          player.fn,
          player.ln
        ]
          .filter(Boolean)
          .join(" ")
      );

  const draftBoardMap =
    new Map();

  draftBoardPlayers.forEach(
    (player, boardRank) => {

      draftBoardMap.set(
        fullNameKey(player),
        {
          player,
          boardRank
        }
      );
    }
  );

  const merged =
    prospects.map(
      (prospect, sourceOrder) => {

        const match =
          draftBoardMap.get(
            fullNameKey(prospect)
          );

        if (!match) {

          return {
            ...prospect,
            sourceOrder,
            draftBoardMatched:
              false
          };
        }

        const boardPlayer =
          match.player;

        return {

          ...prospect,

          position:
            prospect.position ||
            boardPlayer.position,

          team:
            prospect.team ||
            boardPlayer.team,

          country:
            prospect.country ||
            boardPlayer.country,

          stats:
            boardPlayer.stats,

          sourceOrder,

          boardRank:
            match.boardRank,

          draftBoardMatched:
            true
        };
      }
    );

  const prospectKeys =
    new Set(
      prospects.map(fullNameKey)
    );

  // Board players missing from the prospect index must not be dropped.
  draftBoardPlayers.forEach(
    (player, boardRank) => {

      if (
        prospectKeys.has(
          fullNameKey(player)
        )
      ) {

        return;
      }

      merged.push({
        ...player,
        sourceOrder:
          prospects.length + boardRank,
        boardRank,
        draftBoardMatched:
          true
      });
    }
  );

  return merged;
}

/*
  Orders real players so a class that is cut off at its size
  always contains the most important players.

  Draft classes: actual overall pick (or round and pick), then
  the draft board's projected order, then source order.
  Freshman classes: highest stars/rating, then highest
  potential/max prep value, then source order.
*/
function rankRealPlayers(
  players,
  type
) {

  const numberOr =
    (value, fallback) =>
      value != null &&
      value !== "" &&
      Number.isFinite(Number(value))
        ? Number(value)
        : fallback;

  const firstNumber =
    (player, fields, fallback) => {

      for (const field of fields) {

        const value =
          numberOr(
            player[field],
            null
          );

        if (value !== null) {

          return value;
        }
      }

      return fallback;
    };

  if (type === "freshman") {

    const descending =
      (player, fields) =>
        -firstNumber(
          player,
          fields,
          -Infinity
        );

    return players
      .slice()
      .sort(
        (a, b) =>
          descending(a, ["stars", "starRating", "rating", "ovr"]) -
            descending(b, ["stars", "starRating", "rating", "ovr"]) ||
          descending(a, ["pot", "potential", "maxPrep", "prepMax"]) -
            descending(b, ["pot", "potential", "maxPrep", "prepMax"]) ||
          firstNumber(a, ["rank", "sourceOrder"], Infinity) -
            firstNumber(b, ["rank", "sourceOrder"], Infinity)
      );
  }

  const roundOneSize =
    Math.max(
      0,
      ...players
        .filter(
          player =>
            Number(player.draftRound) === 1
        )
        .map(
          player =>
            numberOr(
              player.roundPick,
              0
            )
        )
    );

  const overall =
    player => {

      const pick =
        numberOr(
          player.draftPick,
          null
        );

      if (pick !== null) {

        return pick;
      }

      const round =
        numberOr(
          player.draftRound,
          null
        );

      const roundPick =
        numberOr(
          player.roundPick,
          null
        );

      return round !== null &&
        roundPick !== null &&
        roundOneSize > 0
        ? (round - 1) * roundOneSize + roundPick
        : Infinity;
    };

  return players
    .slice()
    .sort(
      (a, b) => {

        const pickA = overall(a);
        const pickB = overall(b);

        if (pickA !== pickB) {

          return pickA < pickB
            ? -1
            : 1;
        }

        return (
          firstNumber(a, ["projectedPick", "mockPick", "boardRank"], Infinity) -
            firstNumber(b, ["projectedPick", "mockPick", "boardRank"], Infinity)
          || firstNumber(a, ["sourceOrder"], Infinity) -
            firstNumber(b, ["sourceOrder"], Infinity)
        );
      }
    );
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
    /(\d+)\s*['’]\s*(\d+)\s*(?:['’]{2}|")\s*-\s*([A-Z]+(?:\/[A-Z]+)*)(?:\s*-\s*(\d{4}))?/
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
  player.draftPick ?? null,


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
  player.draftPick ?? null,

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

    const prospectURL =
  "https://www.wnba.com/draft/2026/prospects";

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
    const prospectResponse =
  await fetch(
    prospectURL,
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
  !sourceResponse.ok ||
  !prospectResponse.ok
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

    const prospectText =
  await prospectResponse.text();

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
    
const draftBoardPlayers =
  parseWnbaDraftBoard(
    sourceText
  );


const prospectPlayers =
  parseWnbaProspectIndex(
    prospectText
  );


const draftPlayers =
  mergeProspectPoolWithDraftBoard(
    prospectPlayers,
    draftBoardPlayers
  );


const biographies =
  biographyText
    ? parseUsbasketBiographies(
        biographyText,
        draftPlayers
      )
    : [];

const players =
  rankRealPlayers(
    mergeDraftBiographies(
      draftPlayers,
      biographies
    ),
    type
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

        draftLinksFound:
  draftBoardPlayers.diagnostics.linksFound,

draftPlayersAccepted:
  draftBoardPlayers.diagnostics.acceptedPlayers,

draftPlayersRejected:
  draftBoardPlayers.diagnostics.rejectedPlayers,

rejectedDraftSamples:
  draftBoardPlayers.diagnostics.rejectedSamples,

prospectIndexPlayers:
  prospectPlayers.length,

mergedPlayerPool:
  draftPlayers.length,

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
