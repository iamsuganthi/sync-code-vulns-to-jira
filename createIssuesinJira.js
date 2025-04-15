// getFilteredIssueIdAndPaths.js
require('dotenv').config();
const axios = require('axios');

// --- Configuration ---
const SNYK_TOKEN = process.env.SNYK_TOKEN;
const ORG_ID = process.env.SNYK_ORG_ID;
const PROJECT_ID = process.env.SNYK_PROJECT_ID;
const ORG_NAME = process.env.ORG_NAME;

const SNYK_API_BASE = 'https://api.snyk.io/rest';
const SNYK_V1_API_BASE = 'https://api.snyk.io/v1'; // Note: Using v1 base

// API Versions
const LIST_ISSUES_API_VERSION = '2021-08-20~experimental';
const CODE_DETAIL_API_VERSION = '2022-04-06~experimental';

const folderProjectMap = {
    'routes': 'APJ',
    'test': 'STJI'
}
const wildcardJiraProj = 'EAS'
const headers = {
    'Authorization': `token ${SNYK_TOKEN}`,
    'Accept': 'application/vnd.api+json'
};
class SnykApi {

    static handleApiError(error, context = '') {
        // (Keep the existing handleApiError function)
        console.error(`Error ${context}:`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            if (error.response.status !== 404) {
                console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
            } else {
                console.error('Resource not found (404).');
            }
        } else if (error.request) {
            console.error('Request Error: No response received.');
        } else {
            console.error('Error Message:', error.message);
        }
    }

    static async fetchCodeIssueFilePath(orgId, projectId, issueId) {
        // (Keep the existing fetchCodeIssueFilePath function)
        const detailUrl = `${SNYK_API_BASE}/orgs/${orgId}/issues/detail/code/${issueId}?project_id=${projectId}&version=${CODE_DETAIL_API_VERSION}`;

        try {
            const response = await axios.get(detailUrl, { headers });
            const filePath = response.data?.data?.attributes?.primaryFilePath;
            console.log("======")
            console.log(response.data?.data?.attributes)
            if (filePath && typeof filePath === 'string') {
                console.log(`   -> Found path for ${issueId}: ${filePath}`);
                return response.data?.data?.attributes; // Return only the path
            } else {
                console.warn(`   -> Warning: Could not extract 'primaryFilePath' for issue ${issueId}.`);
                return null;
            }
        } catch (error) {
            if (error.response?.status !== 404) {
                this.handleApiError(error, `fetching code issue detail for ${issueId}`);
            } else {
                console.warn(`   -> Warning: Experimental detail endpoint returned 404 for issue ${issueId}.`);
            }
            return null;
        }
    }

    static async fetchAllIssuePages() {
        let allIssueSummaries = [];
        let nextUrl = `${SNYK_API_BASE}/orgs/${ORG_ID}/issues?project_id=${PROJECT_ID}&version=${LIST_ISSUES_API_VERSION}&limit=100`;
        console.log('Fetching initial list of all issues...');
        try {
            while (nextUrl) {
                console.log(`Fetching list page from: ${nextUrl.replace(SNYK_API_BASE, '')}`);
                const response = await axios.get(nextUrl, { headers });
                if (response.data?.data) {
                    allIssueSummaries = allIssueSummaries.concat(response.data.data);
                }
                nextUrl = response.data.links?.next ? `${SNYK_API_BASE}${response.data.links.next}` : null;
            }
            console.log(`Finished fetching initial list. Total issues (all types): ${allIssueSummaries.length}`);
            return allIssueSummaries;
        } catch (error) {
            this.handleApiError(error, 'fetching initial issue list');
            throw new Error('Failed to fetch initial issue list from Snyk API.');
        }
    }

    static async getJiraLinkedSnykIssueIds() {
        // Construct the specific v1 API URL
        const jiraIssuesUrl = `${SNYK_V1_API_BASE}/org/${ORG_ID}/project/${PROJECT_ID}/jira-issues`;
        console.log(`Querying v1 endpoint: ${jiraIssuesUrl}`);

        try {
            const response = await axios.get(jiraIssuesUrl, { headers: {
                    'Authorization': `token ${SNYK_TOKEN}`} });

            console.log(response)
            // The v1 response is typically the array directly in response.data
            // Each object in the array usually represents a Jira link record
            if (response.data) {
                console.log(`Found ${response.data.length} Jira link records for project ${PROJECT_ID}.`);

                // Extract the 'snykIssueId' from each record in the array
                const snykIssueIds =  Object.keys(response.data);
                console.log(snykIssueIds)
                // Return unique IDs using Set
                const uniqueIds = Array.from(new Set(snykIssueIds));
                console.log(`Extracted ${uniqueIds.length} unique Snyk Issue IDs.`);
                return uniqueIds;

            } else {
                console.warn(`No Jira link records found or unexpected response structure from ${jiraIssuesUrl}.`);
                // console.warn('Response Data:', JSON.stringify(response.data, null, 2)); // Uncomment to debug structure
                return []; // Return empty array if no data or not an array
            }
        } catch (error) {
            // Handle 404 specifically - likely means project not found or no Jira links exist
            if (error.response?.status === 404) {
                console.warn(`Warning: Received 404 from ${jiraIssuesUrl}. Project might not exist or has no Jira links.`);
            } else {
                this.handleApiError(error, `fetching Jira linked Snyk Issue IDs for project ${PROJECT_ID} (v1 API)`);
            }
            return []; // Return empty array on any error
        }
    }

    static async createJiraTicketForSnykIssue(snykIssueId, jiraProjectId, jiraSummary, jiraDesc) {
        const apiUrl = `${SNYK_V1_API_BASE}/org/${ORG_ID}/project/${PROJECT_ID}/issue/${snykIssueId}/jira-issue`;
        console.log(`Attempting POST to: ${apiUrl}`);

        // Base structure with mandatory fields required by Jira
        const requestBody = {
            fields: {
                project: {
                    key: jiraProjectId // Ensure it's a string if API expects it, common for Jira IDs
                },
                issuetype: {
                    name: 'Task'
                },
                summary: jiraSummary,
                // Add a default description linking back to Snyk issue for context
                description: jiraDesc
                // Merge other optional fields provided by the caller
                // ...optionalFields
            }
        };
        // Remove description from optionalFields if it was provided, as we handled it above


        console.log("Request URL:", apiUrl);
        console.log("Request Body:", JSON.stringify(requestBody, null, 2)); // Log the body for debugging

        // --- Make API Call ---
        try {
            const response = await axios.post(apiUrl, requestBody, { headers });
            console.log(`Successfully created/linked Jira issue for Snyk issue ${snykIssueId}.`);
            console.log("Snyk API Response:", JSON.stringify(response.data, null, 2));
            // The response data might contain the Jira issue key/URL created
            return response.data; // Return the successful response data

        } catch (error) {
            this.handleApiError(error, `creating Jira ticket for Snyk issue ${snykIssueId}`);
            return null; // Indicate failure
        }
    }
}

function makeIssueDesc(issue) {
    return `Issue details: \n Title: ${issue.attributes.title} \n Severity: ${issue.attributes.severity} \n \n
    Priority Score: ${issue.priorityScore} 
    Snyk vulnerability details: https://app.snyk.io/org/${ORG_NAME}/project/${PROJECT_ID}#${issue.id}\n\n(Ticket auto-generated by Snyk integration)`
}

function makeIssueSummary(issue) {
    return `${issue.attributes.title}`
}

function getIssuesWithoutJiraTickets(allIssueSummaries, jiraLinkedSnykIssueIds) {
    const exclusionSet = new Set(jiraLinkedSnykIssueIds);
    const filteredSummaries = allIssueSummaries.filter(summary => {
        return !exclusionSet.has(summary.id);
    });
    return filteredSummaries;
}

async function populateSourceFilePath(issueSummary) {
    const issueId = issueSummary.id;
    const additionalAttrs = await SnykApi.fetchCodeIssueFilePath(ORG_ID, PROJECT_ID, issueId);
    issueSummary.priorityScore = additionalAttrs.priorityScore;
    issueSummary.filePath = additionalAttrs.filePath;
}

function mapIssuesToJiraBoard(filteredSummaries) {
    let jiraProjectToIssuesMap = {}
    for (const issue of filteredSummaries) {
        let targetJiraProject = null; // Variable to hold the determined project key for this issue

        // Check against specific folder keys (most specific first)
        for (const folderKey of Object.keys(folderProjectMap)) {
            // Check if the filePath starts with the folderKey.
            // Assumes keys like 'routes' should match paths like 'routes/file.js'
            if (issue.filePath && issue.filePath.startsWith(folderKey)) {
                targetJiraProject = folderProjectMap[folderKey];
                break; // Found the most specific match, stop checking
            }
        }

        // If no specific folder key matched, use the wildcard/default project
        if (!targetJiraProject) {
            targetJiraProject = wildcardJiraProj;
        }

        if (!jiraProjectToIssuesMap[targetJiraProject]) {
            jiraProjectToIssuesMap[targetJiraProject] = [];
        }
        // Add the current issue's ID to the array for that Jira project
        jiraProjectToIssuesMap[targetJiraProject].push(issue);
    }
    return jiraProjectToIssuesMap;
}

async function getFilteredIssueIdAndPaths() {
    // Input validation
    if (!SNYK_TOKEN || !ORG_ID || !PROJECT_ID || !ORG_NAME) {
        console.error('Error: Missing required environment variables (SNYK_TOKEN, SNYK_ORG_ID, SNYK_PROJECT_ID, ORG_NAME).');
        process.exit(1);
    }

    const jiraLinkedSnykIssueIds = await SnykApi.getJiraLinkedSnykIssueIds()

    try {
        const allIssueSummaries = await SnykApi.fetchAllIssuePages();
        if (allIssueSummaries.length === 0) {
            console.log("\nNo issues found for this project.");
            process.exit(0);
        }
        console.log(`\nProcessing ${allIssueSummaries.length} issues. Attempting to fetch 'primaryFilePath' for all using code detail endpoint...`);

        const filteredSummaries = getIssuesWithoutJiraTickets(allIssueSummaries, jiraLinkedSnykIssueIds);
        for (const issueSummary of filteredSummaries) await populateSourceFilePath(issueSummary);

        const jiraProjectToIssuesMap = mapIssuesToJiraBoard(filteredSummaries);

        console.log(jiraProjectToIssuesMap)
        let allProjects = Object.keys(jiraProjectToIssuesMap);
        for (const jiraProj of allProjects) {
            for (const issue of jiraProjectToIssuesMap[jiraProj]) {
                await SnykApi.createJiraTicketForSnykIssue(issue.id, jiraProj, makeIssueSummary(issue), makeIssueDesc(issue))
            }
        }
    } catch (error) {
        console.error('\nScript failed during processing:', error.message);
        process.exit(1);
    }
}

// --- Run the script ---
getFilteredIssueIdAndPaths();

