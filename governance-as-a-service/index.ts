import { Wallet } from "ethers"
import * as dotenv from "dotenv"
import { EntityMetadata, API, Models, ProcessMetadata, Network } from "dvote-js"
import { GatewayPool } from "dvote-js/dist/net/gateway-pool"
import { digestHexClaim } from "dvote-js/dist/api/census"
import { waitUntilVochainBlock } from "dvote-js/dist/util/waiters"

dotenv.config()  // Load .env

const MNEMONIC = "whale pyramid cross pilot myself fashion life pottery motor symptom claim color"
const GATEWAY_BOOTNODE_URI = "https://bootnodes.vocdoni.net/gateways.dev.json"
const NETWORK_ID = "sokol"

const entityWallet: Wallet = Wallet.fromMnemonic(MNEMONIC, "m/44'/60'/0'/0/0")
const voterWallets: Wallet[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(idx => Wallet.fromMnemonic(MNEMONIC, "m/44'/60'/0'/0/" + idx))

let pool: GatewayPool
let votersPublicKeys: string[] = []
let merkleTreeOrigin: string
let merkleRoot: string
let processId: string = "0x35bde37ea31f18b5dbba6afff4fd2de24519c712cb0a4488ab17d16dbcef1c30"

// Code

async function connect() {
    // Get a pool of gateways to connect to the network
    pool = await GatewayPool.discover({ networkId: NETWORK_ID, bootnodesContentUri: GATEWAY_BOOTNODE_URI })
    await pool.connect()
}

const disconnect = () => pool.disconnect()

async function registerEntity() {
    // Make a copy of the metadata template and customize it
    const entityMetadata: EntityMetadata = Object.assign({}, Models.Entity.EntityMetadataTemplate)

    entityMetadata.name.default = "Vilafourier"
    entityMetadata.description.default = "Official communication and participation channel of the city council"
    entityMetadata.media = {
        avatar: 'https://ipfs.io/ipfs/QmWm23t4FdCYdEpTmYYWdjPZFepCvk9GJTSSMdv8xU3Hm9',
        header: 'https://ipfs.io/ipfs/Qmb4tMak41v6WigrFqovo6AATy23pNZGFCa9PHJDjg6kWz'
    }
    entityMetadata.actions = []

    console.log("Setting the entity metadata")
    const contentUri = await API.Entity.updateEntity(entityWallet.address, entityMetadata, entityWallet, pool)

    // Show stored values
    console.log("Entity defined")
    console.log(contentUri)
}

function populateCensusPublicKeys() {
    // Use reproduceable wallets of 10 users to populate our census with public keys
    voterWallets.forEach(wallet => {
        votersPublicKeys.push(wallet["signingKey"].publicKey)
    })
    console.log("Voter's public keys", votersPublicKeys)
}

async function publishVoteCensus() {
    // Prepare the census parameters
    const censusName = "Vilafourier all members " + Math.random().toString().substr(2, 6)
    const adminPublicKeys = [await entityWallet["signingKey"].publicKey]
    const publicKeyClaims = votersPublicKeys.map(k => digestHexClaim(k)) // hash the keys

    // As the census does not exist yet, create it
    let { censusId } = await API.Census.addCensus(censusName, adminPublicKeys, pool, entityWallet)
    console.log(`Added census "${censusName}" with ID ${censusId}`)

    // Add claims to the new census
    let result = await API.Census.addClaimBulk(censusId, publicKeyClaims, true, pool, entityWallet)
    console.log("Added", votersPublicKeys.length, "claims to", censusId)
    if (result.invalidClaims.length > 0) console.error("Invalid claims", result.invalidClaims)

    merkleRoot = await API.Census.getRoot(censusId, pool)
    console.log("Census Merkle Root", merkleRoot)

    // Make it available publicly
    merkleTreeOrigin = await API.Census.publishCensus(censusId, pool, entityWallet)
    console.log("Census published on", merkleTreeOrigin)
}

async function createVotingProcess() {
    const myEntityAddress = await entityWallet.getAddress()
    const myEntityId = API.Entity.getEntityId(myEntityAddress)

    const startBlock = await API.Vote.estimateBlockAtDateTime(new Date(Date.now() + 1000 * 60 * 5), pool)
    const numberOfBlocks = 6 * 60 * 24 // 1 day (10s block time)

    const processMetadata: ProcessMetadata = {
        "version": "1.0",
        "type": "poll-vote",
        "startBlock": startBlock,
        "numberOfBlocks": numberOfBlocks,
        "census": {
            "merkleRoot": merkleRoot,
            "merkleTree": merkleTreeOrigin
        },
        "details": {
            "entityId": myEntityId,
            "title": { "default": "Vilafourier public poll" },
            "description": {
                "default": "This is our test poll using a decentralized blockchain to register votes"
            },
            "headerImage": "https://images.unsplash.com/photo-1600190184658-4c4b088ec92c?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=1350&q=80",
            "streamUrl": "",
            "questions": [
                {
                    "type": "single-choice",
                    "question": { "default": "CEO" },
                    "description": { "default": "Chief Executive Officer" },
                    "voteOptions": [
                        { "title": { "default": "Yellow candidate" }, "value": 0 },
                        { "title": { "default": "Pink candidate" }, "value": 1 },
                        { "title": { "default": "Abstention" }, "value": 2 },
                        { "title": { "default": "White vote" }, "value": 3 }
                    ]
                },
                {
                    "type": "single-choice",
                    "question": { "default": "CFO" },
                    "description": { "default": "Chief Financial Officer" },
                    "voteOptions": [
                        { "title": { "default": "Yellow candidate" }, "value": 0 },
                        { "title": { "default": "Pink candidate" }, "value": 1 },
                        { "title": { "default": "Abstention" }, "value": 2 },
                        { "title": { "default": "White vote" }, "value": 3 }
                    ]
                },
            ]
        }
    }
    processId = await API.Vote.createVotingProcess(processMetadata, entityWallet, pool)
    console.log("Process created:", processId)

    // Reading the process metadata back
    const metadata = await API.Vote.getVoteMetadata(processId, pool)
    console.log("The metadata is", metadata)
}

async function submitSingleVote() {
    // Get the user private key from the appropriate place
    const wallet = voterWallets[0]

    // Fetch the metadata
    const processMeta = await API.Vote.getVoteMetadata(processId, pool)

    console.log("- Starting:", await API.Vote.estimateDateAtBlock(processMeta.startBlock, pool))
    console.log("- Ending:", await API.Vote.estimateDateAtBlock(processMeta.startBlock + processMeta.numberOfBlocks, pool))
    console.log("- Census size:", await API.Census.getCensusSize(processMeta.census.merkleRoot, pool))
    console.log("- Current block:", await API.Vote.getBlockHeight(pool))
    console.log("- Current votes:", await API.Vote.getEnvelopeHeight(processId, pool))

    await waitUntilVochainBlock(processMeta.startBlock, pool, { verbose: true })

    console.log("Submitting vote envelopes")

    // Hash the voter's public key
    const publicKeyHash = digestHexClaim(wallet["signingKey"].publicKey)

    // Generate the census proof
    const merkleProof = await API.Census.generateProof(processMeta.census.merkleRoot, publicKeyHash, true, pool)

    // Sign the vote envelope with our choices
    const choices = [1, 2]
    const voteEnvelope = await API.Vote.packagePollEnvelope({ votes: choices, merkleProof, processId, walletOrSigner: wallet })

    // If the process had encrypted votes:
    // const voteEnvelope = await packagePollEnvelope({ votes, merkleProof, processId, walletOrSigner: wallet, encryptionPubKeys: ["..."] })

    await API.Vote.submitEnvelope(voteEnvelope, pool)
    console.log("Envelope submitted")

    // wait 10 seconds
    await new Promise(resolve => setTimeout(resolve, 1000 * 10))

    // Compute our deterministic nullifier to check the status of our vote
    const nullifier = await API.Vote.getPollNullifier(wallet.address, processId)
    const status = await API.Vote.getEnvelopeStatus(processId, nullifier, pool)

    console.log("- Registered: ", status.registered)
    console.log("- Block: ", status.block)
    console.log("- Date: ", status.date)
}

async function submitVotes() {
    const processMeta = await API.Vote.getVoteMetadata(processId, pool)

    console.log("- Starting:", await API.Vote.estimateDateAtBlock(processMeta.startBlock, pool))
    console.log("- Ending:", await API.Vote.estimateDateAtBlock(processMeta.startBlock + processMeta.numberOfBlocks, pool))
    console.log("- Census size:", await API.Census.getCensusSize(processMeta.census.merkleRoot, pool))
    console.log("- Current block:", await API.Vote.getBlockHeight(pool))
    console.log("- Current votes:", await API.Vote.getEnvelopeHeight(processId, pool))

    await waitUntilVochainBlock(processMeta.startBlock, pool, { verbose: true })

    console.log("Submitting vote envelopes")

    // For each wallet from 2..10, submit a vote
    await Promise.all(voterWallets.slice(1).map(async wallet => {
        // Hash the voter's public key
        const publicKeyHash = digestHexClaim(wallet["signingKey"].publicKey)

        // Generate the census proof
        const merkleProof = await API.Census.generateProof(processMeta.census.merkleRoot, publicKeyHash, true, pool)

        // Sign the vote envelope with our choices
        const choices = [1, 2]
        const voteEnvelope = await API.Vote.packagePollEnvelope({ votes: choices, merkleProof, processId, walletOrSigner: wallet })

        // If the process had encrypted votes:
        // const voteEnvelope = await packagePollEnvelope({ votes, merkleProof, processId, walletOrSigner: wallet, encryptionPubKeys: ["..."] })

        await API.Vote.submitEnvelope(voteEnvelope, pool)
        process.stdout.write(".")
    }))
}

async function fetchResults() {
    const { questions } = await API.Vote.getResultsDigest(processId, pool)

    console.log("Process results", questions)
}

async function forceEndingProcess() {
    // Already canceled?
    const canceled = await API.Vote.isCanceled(processId, pool)
    if (canceled) return console.log("Process already canceled")

    // Already ended?
    const processMeta = await API.Vote.getVoteMetadata(processId, pool)
    const currentBlock = await API.Vote.getBlockHeight(pool)
    if (currentBlock >= (processMeta.startBlock + processMeta.numberOfBlocks)) return console.log("Process already ended")

    console.log("Canceling process", processId)
    await API.Vote.cancelProcess(processId, entityWallet, pool)
    console.log("Done")
}


// Launch all the steps

connect()
    .then(() => registerEntity())
    .then(() => populateCensusPublicKeys())
    .then(() => publishVoteCensus())
    .then(() => createVotingProcess())
    .then(() => submitSingleVote())
    .then(() => submitVotes())
    .then(() => fetchResults())
    .then(() => forceEndingProcess())
    .catch(err => console.error(err))
    .finally(() => disconnect())
