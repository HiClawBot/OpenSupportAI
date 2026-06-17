export type ProjectPublicKeyAuth = {
  mode: "public_key";
  projectId: string;
  publicKey: string;
};

export type SignedUserTokenAuth = {
  mode: "signed_user_token";
  token: string;
};

export type ClientAuth = ProjectPublicKeyAuth | SignedUserTokenAuth;

export type AdminAuthContext = {
  organizationId: string;
  projectId?: string;
  actorId: string;
};
