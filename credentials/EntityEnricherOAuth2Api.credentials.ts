import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * OAuth 2.1 credential for Entity Enricher (authorization code + PKCE).
 *
 * Extends n8n's generic oAuth2Api with the PKCE grant type preset — Entity
 * Enricher's embedded authorization server mandates S256 PKCE and issues
 * org-registered clients as *public* clients (no secret; n8n's PKCE grant
 * does not send one at token exchange).
 *
 * Setup: an organization owner creates an OAuth client under
 * Settings → API Keys → OAuth Clients, pasting this n8n instance's callback
 * URL (shown by n8n on this credential), then copies the client ID here.
 */
export class EntityEnricherOAuth2Api implements ICredentialType {
	name = 'entityEnricherOAuth2Api';
	displayName = 'Entity Enricher OAuth2 API';
	extends = ['oAuth2Api'];
	documentationUrl = 'https://entityenricher.ai/docs/integrations/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://entityenricher.ai',
			placeholder: 'https://entityenricher.ai',
			description: 'Base URL of your Entity Enricher instance',
		},
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'pkce',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: '={{$self["baseUrl"].replace(/\\/$/, "")}}/api/oauth/authorize',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: '={{$self["baseUrl"].replace(/\\/$/, "")}}/api/oauth/token',
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			required: true,
			default: '',
			description:
				'Create an OAuth client in Entity Enricher (Settings → API Keys → OAuth Clients) with this n8n instance\'s OAuth callback URL, then paste its client ID here',
		},
		{
			// Org-registered clients are public (PKCE is the possession proof);
			// n8n's PKCE grant would not send a secret anyway.
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: 'api',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
	];
}
