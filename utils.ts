import axios from 'axios';
import Storage from 'node-persist';

const WEBHOOK_URL = '';
const API_KEY = '';

const notified: number[] = [];

(async () => {
	await Storage.init();

	console.log('Initialized...');

	const keys = await Storage.keys();

	for (const key of keys) {
		notified.push(Number(key));
	}
})();

const cacheEvent = async (id: number) => {
	await Storage.setItem(id.toString(), true);
	notified.push(id);
};

const openzee = axios.create({
	baseURL: 'https://api.opensea.io/api/v1',
	headers: {
		Accept: 'application/json',
		'X-API-KEY': API_KEY,
	},
});

interface Account {
	user?: { username: string };
	address: string;
}

interface AssetEventSale {
	id: number;
	quantity: number;
	seller: Account;
	winner_account: Account;
	asset: {
		id: number;
		token_id: string;
		image_url: string;
		name: string;
		permalink: string;
		collection: {
			name: string;
			image_url: string;
		};
	};
	total_price: any;
	payment_token: {
		symbol: string;
		usd_price: number;
		decimals: number;
	};
}

interface FetchEventsResponse {
	asset_events: AssetEventSale[];
}

interface FetchEventsInput {
	asset_contract_address?: string;
	limit: number;
	collection_slug?: string;
	event_type:
		| 'created'
		| 'successful'
		| 'cancelled'
		| 'bid_entered'
		| 'bid_withdrawn'
		| 'transfer'
		| 'approve';
}

interface Sale {
	id: number;
	asset_name: string;
	collection_name: string;
	price: {
		usd: string;
		native: number;
		currency: string;
	};
	icon: string;
	url: string;
	seller: {
		short: string;
		url: string;
	};
	buyer: {
		short: string;
		url: string;
	};
	image: string;
}

const shortenAddress = (address: string): string =>
	address.replace(address.slice(4, 38), '...');

async function sendSaleEmbed(sale: Sale) {
	const payload = {
		embeds: [
			{
				title: `${sale.asset_name} was purchased!`,
				url: sale.url,
				color: 5814783,
				fields: [
					{
						name: 'Sale Price',
						value: `${sale.price.native} ${sale.price.currency}`,
					},
					...(!sale.price.currency.includes('USD')
						? [
								{
									name: 'Sale Price USD',
									value: `$${sale.price.usd}`,
								},
						  ]
						: []),
					{
						name: 'Buyer',
						value: `[${sale.buyer.short}](${sale.buyer.url})`,
						inline: true,
					},
					{
						name: 'Seller',
						value: `[${sale.seller.short}](${sale.seller.url})`,
						inline: true,
					},
				],
				footer: {
					text: sale.collection_name,
					icon_url: sale.icon,
				},
				timestamp: new Date().toJSON(),
				thumbnail: {
					url: sale.image,
				},
			},
		],
	};
	console.log(JSON.stringify(payload, null, 4));
	axios.post(WEBHOOK_URL, payload);
}

export async function fetchEvents(params: FetchEventsInput): Promise<void> {
	const {
		data: { asset_events },
	} = await openzee.get<FetchEventsResponse>('/events', { params });

	for (const event of asset_events) {
		if (notified.includes(event.id)) continue;

		const tokensNative =
			event.total_price / Number(1 + '0'.repeat(event.payment_token.decimals));

		const sale: Sale = {
			id: event.asset.id,
			asset_name: event.asset.name,
			collection_name: event.asset.collection.name,
			image: event.asset.image_url,
			url: event.asset.permalink,
			icon: event.asset.collection.image_url,
			seller: {
				short:
					event.seller.user?.username ?? shortenAddress(event.seller.address),
				url: `https://opensea.io/${event.seller.address}`,
			},
			buyer: {
				short:
					event.winner_account.user?.username ??
					shortenAddress(event.winner_account.address),
				url: `https://opensea.io/${event.winner_account.address}`,
			},
			price: {
				usd: Math.floor(
					tokensNative * event.payment_token.usd_price
				).toLocaleString('en-US'),
				native: tokensNative,
				currency: event.payment_token.symbol,
			},
		};
		console.log(event);
		await cacheEvent(event.id);
		sendSaleEmbed(sale);
	}
}

export function initialize(params: FetchEventsInput) {
	setInterval(function () {
		fetchEvents(params);
	}, 1000 * 60);
}
