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
          )
      },

      players:
        []

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
