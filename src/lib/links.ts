const USERNAME = /^[a-z0-9_]{3,20}$/;

/**
 * A profile url from whichever half the caller happens to hold. `get_user_names` falls back
 * to the raw uid when it cannot find someone, so anything that is not a legal username goes
 * the /user route, which looks the handle up and redirects.
 */
export const profile_url = (username: string | undefined, uid: string): string =>
	username && USERNAME.test(username) ? `/@${username}` : `/user/${uid}`;
