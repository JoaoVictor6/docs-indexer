import { Elysia } from "elysia";

export const authPlugin = new Elysia({ name: "auth" }).derive(({ headers }) => {
  const authorization = headers["authorization"];

  return {
    auth: {
      authenticated: authorization !== undefined,
      // When real auth is implemented, parse the JWT/bearer token here
      // and populate: userId, projectPermissions, roles, etc.
    },
  };
});
