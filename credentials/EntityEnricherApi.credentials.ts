import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class EntityEnricherApi implements ICredentialType {
	name = 'entityEnricherApi';
	displayName = 'Entity Enricher API';
	documentationUrl = 'https://entityenricher.ai/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'ent_...',
			description: 'Organization access key from Entity Enricher (API Keys page)',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://entityenricher.ai',
			placeholder: 'https://entityenricher.ai',
			description: 'Base URL of your Entity Enricher instance',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/enrichment/options',
			method: 'GET',
		},
	};
}
