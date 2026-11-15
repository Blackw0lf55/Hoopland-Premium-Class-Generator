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


      return Response.json({

        ok:
          true,

        message:
          "Real class API is working.",

        request: {
          gender:
            gender,

          type:
            type,

          year:
            year
        },

        players:
          []

      });

    }


    return env.ASSETS.fetch(
      request
    );

  }

};
